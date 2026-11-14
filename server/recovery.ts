import {DatabaseSync, backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,existsSync,realpathSync,mkdirSync,openSync,closeSync,readSync,chmodSync,linkSync,unlinkSync,rmSync,fsyncSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';

import {RECOVERY_TABLES} from './data-tables.ts';
export {RECOVERY_TABLES} from './data-tables.ts';
export interface RecoveryReport {path:string;integrity:'ok';schemaVersion:1|2;foreignKeys:'ok';counts:Record<string,number>;mainFileSha256:string;sessionsRevoked?:number}
const migration=readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8');
function schema(db:DatabaseSync){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row,sql:String(row.sql).replace(/\s+/g,' ').trim()}));}
const expected=(()=>{const db=new DatabaseSync(':memory:');try{
 db.exec(migration);const legacy=JSON.stringify(schema(db));
 db.exec(readFileSync(new URL('../migrations/002_language.sql',import.meta.url),'utf8'));
 return [legacy,JSON.stringify(schema(db))] as const;
}finally{db.close();}})();
function regular(path:string){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('La fuente debe ser un archivo regular, sin enlaces simbólicos.');return realpathSync(path);}
function checksum(path:string){const hash=createHash('sha256'),buffer=Buffer.alloc(65536),fd=openSync(path,'r');try{let length;while((length=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length));return hash.digest('hex');}finally{closeSync(fd);}}
function inspect(db:DatabaseSync,path:string):RecoveryReport {
 db.exec('PRAGMA trusted_schema=OFF; BEGIN');
 try {
  const version=expected.indexOf(JSON.stringify(schema(db)));
  if(version<0)throw Error('Esquema incompatible: se requiere un esquema completo compatible de Focus Hub.');
  const integrity=db.prepare('PRAGMA integrity_check').all();if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw Error('La base no supera integrity_check.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('La base contiene relaciones inválidas (foreign_key_check).');
  const counts=Object.fromEntries(RECOVERY_TABLES.map(table=>[table,Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count)]));
  db.exec('COMMIT');return {path,integrity:'ok',schemaVersion:(version+1) as 1|2,foreignKeys:'ok',counts,mainFileSha256:checksum(path)};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
/** No migration or row contents are returned. Hash covers the main file, not a live WAL. */
export function verifyDatabase(path:string):RecoveryReport {const source=regular(resolve(path));const db=new DatabaseSync(source,{readOnly:true});try{return inspect(db,source);}finally{db.close();}}
function targetPath(path:string){
 const target=resolve(path);for(const suffix of ['','-wal','-shm','-journal']){try{lstatSync(target+suffix);throw Error('El destino o sus archivos auxiliares ya existen; no se sobrescribe nada.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 mkdirSync(dirname(target),{recursive:true,mode:0o700});
 if(realpathSync(dirname(target))!==dirname(target))throw Error('El directorio de destino no puede atravesar enlaces simbólicos.');
 return target;
}
function stopped(){
 const pidFile=resolve('.data/codespaces-server.pid');if(!existsSync(pidFile))return;
 const value=JSON.parse(readFileSync(pidFile,'utf8'));const pid=typeof value==='number'?value:value.pid;
 if(!Number.isSafeInteger(pid)||pid<1)throw Error('PID gestionado inválido; detén y revisa el servicio antes de restaurar.');
 try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return;throw error;}
 // Inspect only the recorded process. Never signal or stop any process here.
 try{if(/\) Z /.test(readFileSync(`/proc/${pid}/stat`,'utf8')))return;}catch{}
 throw Error('Hay un proceso gestionado activo. Detén el servicio antes de restaurar.');
}
async function copy(sourcePath:string,targetName:string,revoke:boolean):Promise<RecoveryReport>{
 const source=regular(resolve(sourcePath));const target=targetPath(targetName);
 if(source===target)throw Error('La fuente y el destino deben ser distintos.');
 const temp=join(dirname(target),`.focus-recovery-${randomUUID()}.sqlite`);const fd=openSync(temp,'wx',0o600);closeSync(fd);
 let db:DatabaseSync|undefined;
 try {
  db=new DatabaseSync(source,{readOnly:true});
  // Validate source without applying migrations. Backup reads committed WAL safely.
  inspect(db,source);await backup(db,temp);db.close();chmodSync(temp,0o600);
  const before=verifyDatabase(temp);let sessionsRevoked=0;
  if(revoke){const restored=new DatabaseSync(temp);try{restored.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE');sessionsRevoked=Number(restored.prepare('DELETE FROM sessions').run().changes);restored.exec('COMMIT');}finally{restored.close();}}
  const result=verifyDatabase(temp);
  for(const table of RECOVERY_TABLES)if(table!=='sessions'&&result.counts[table]!==before.counts[table])throw Error('La restauración no conserva los registros de la copia.');
  const output=openSync(temp,'r');try{fsyncSync(output);}finally{closeSync(output);}
  // Hard-link creation is atomic and fails if a file/symlink appeared since validation.
  linkSync(temp,target);unlinkSync(temp);
  return {...result,path:target,...(revoke?{sessionsRevoked}: {})};
 }finally{
  try{db?.close();}catch{}
  for(const suffix of ['','-wal','-shm','-journal'])rmSync(temp+suffix,{force:true});
 }
}
export function backupDatabase(source:string,target:string){return copy(source,target,false);}
/** New destination only. Stop unmanaged npm start/dev manually as well. */
export async function restoreDatabase(source:string,target:string){stopped();return copy(source,target,true);}
