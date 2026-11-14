import {createHash,randomUUID} from 'node:crypto';
import {closeSync,fsyncSync,linkSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {RECOVERY_TABLES} from './data-tables.ts';
import {transaction,type Database} from './db.ts';
import {verifyPostgresBackup} from './postgres-recovery.ts';

export class LocalAdoptionError extends Error {}
export type LocalDatabaseKind='demo'|'dev';
export type LocalPostgresBinding={version:1;kind:LocalDatabaseKind;identity:string;backupSha256:string};
const digest=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
function regular(path:string){
 const full=resolve(path),stat=lstatSync(full);
 if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(full)!==full||(stat.mode&0o077))throw new LocalAdoptionError('Se requiere un archivo privado (0600), regular y sin enlaces.');
 return full;
}
export function readActivePostgresBinding(path=resolve('.data/active-postgres.json')):LocalPostgresBinding|undefined{
 try{lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
 let value;try{value=JSON.parse(readFileSync(regular(path),'utf8'));}catch{throw new LocalAdoptionError('La selección PostgreSQL local no se puede leer. Se conserva sin mostrar su contenido.');}
 if(!value||Object.keys(value).sort().join(',')!=='backupSha256,identity,kind,version'||value.version!==1||!['demo','dev'].includes(value.kind)||!/^pg:[a-f0-9]{64}$/.test(value.identity)||! /^[a-f0-9]{64}$/.test(value.backupSha256))throw new LocalAdoptionError('La selección PostgreSQL local no es válida. Se conserva sin reemplazar.');
 return value;
}
export async function validateAdoptedTarget(db:Database,expectedRole:string){
 const role=await db.one(`SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=pg_roles.oid) AS memberships FROM pg_catalog.pg_roles WHERE rolname=current_user`);
 if(!role||role.name!==expectedRole||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolbypassrls||role.memberships)throw new LocalAdoptionError('El destino debe usar su cuenta PostgreSQL dedicada, sin privilegios administrativos ni membresías adicionales.');
 const account=await db.one(`SELECT EXISTS(SELECT 1 FROM users u JOIN workspaces w ON w.owner_user_id=u.id JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id AND m.role='owner') AS present`);
 if(!account?.present)throw new LocalAdoptionError('El destino no contiene una cuenta y workspace válidos. No se crea una demo nueva.');
}
function canonical(rows:Record<string,unknown>[]){
 return JSON.stringify(rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort());
}
function publish(bindingPath:string,binding:LocalPostgresBinding){
 const directory=dirname(resolve(bindingPath));mkdirSync(directory,{recursive:true,mode:0o700});
 if(realpathSync(directory)!==directory||lstatSync(directory).mode&0o077)throw new LocalAdoptionError('La selección requiere un directorio privado (0700), sin enlaces.');
 const temporary=join(directory,`.active-postgres-${randomUUID()}.tmp`);
 try{
  const fd=openSync(temporary,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(binding,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  try{linkSync(temporary,resolve(bindingPath));}
  catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   const existing=readActivePostgresBinding(bindingPath);
   if(existing?.kind!==binding.kind||existing.identity!==binding.identity)throw new LocalAdoptionError('Ya existe una selección distinta. No se sobrescribe.');
  }
 }finally{try{unlinkSync(temporary);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}

}
/** Explicit local handover only. No credentials, data, ownership or old metadata are changed. */
export async function adoptLocalPostgres(db:Database,options:{kind:LocalDatabaseKind;expectedRole:string;backupPath:string;bindingPath?:string;expectedBackupSha256?:string}){
 if(!['demo','dev'].includes(options.kind))throw new LocalAdoptionError('Selecciona demo o dev explícitamente.');
 const bindingPath=options.bindingPath??resolve('.data/active-postgres.json'),existing=readActivePostgresBinding(bindingPath);
 if(existing&&(existing.kind!==options.kind||existing.identity!==db.identity))throw new LocalAdoptionError('Ya existe otro destino adoptado. No se cambia automáticamente.');
 const backupPath=regular(options.backupPath),report=verifyPostgresBackup(backupPath),backup=JSON.parse(readFileSync(backupPath,'utf8'));
 if(options.expectedBackupSha256&&options.expectedBackupSha256!==report.sha256)throw new LocalAdoptionError('El backup cambió después del ensayo de recuperación. Repite el procedimiento.');
 const {sha256,...payload}=backup;
 if(sha256!==report.sha256||digest(JSON.stringify(payload))!==sha256)throw new LocalAdoptionError('El backup ha cambiado. Se conserva la selección actual.');
 const binding:LocalPostgresBinding={version:1,kind:options.kind,identity:db.identity,backupSha256:report.sha256};
 return transaction(db,async()=>{
  // SHARE prevents writes while comparing and publishing the binding. Operators
  // must stop writers first; no process is killed by this tool.
  await db.query(`LOCK TABLE ${RECOVERY_TABLES.join(',')} IN SHARE MODE`);
  await validateAdoptedTarget(db,options.expectedRole);
  const ledger=await db.all('SELECT version,name,checksum FROM schema_migrations ORDER BY version');
  if(canonical(ledger)!==canonical(backup.migrations))throw new LocalAdoptionError('Las migraciones del backup y del destino no coinciden.');
  for(const table of RECOVERY_TABLES){
   if(table==='sessions')continue; // Login/logout after backup does not change business data.
   if(canonical(await db.all(`SELECT * FROM ${table}`))!==canonical(backup.tables[table]))throw new LocalAdoptionError('Los datos del destino no coinciden con el backup. Detén escritores y crea una copia actualizada.');
  }
  if(!existing)publish(bindingPath,binding);
  return existing??binding;
 });
}
