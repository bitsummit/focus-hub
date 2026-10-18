import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,linkSync,unlinkSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {RECOVERY_TABLES} from './data-tables.ts';
import {transaction,type Database} from './db.ts';

export const POSTGRES_DATA_LOCK=1699605851;
const ordered=new Set(['strategic_goals','projects','milestones','tasks','task_events','journal_entries','journal_blocks','focus_items']);
type Cell=string|number|null;
type DataRow=Record<string,Cell>;
type BackupPayload={format:'focus-postgresql-backup';version:1;migrations:Record<string,unknown>[];tables:Record<string,DataRow[]>};
type BackupEnvelope=BackupPayload&{sha256:string};
export interface PostgresRecoveryReport {format:'focus-postgresql-backup';version:1;integrity:'ok';counts:Record<string,number>;sha256:string;sessionsRevoked?:number}
const hash=(data:string)=>createHash('sha256').update(data).digest('hex');
function report(value:BackupEnvelope):PostgresRecoveryReport{return {format:value.format,version:value.version,integrity:'ok',counts:Object.fromEntries(RECOVERY_TABLES.map(table=>[table,value.tables[table].length])),sha256:value.sha256};}
function regular(path:string){const file=resolve(path),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(file)!==file)throw Error('Backup must be a regular file without symbolic links.');return file;}
function parseBackup(path:string):BackupEnvelope{
 const value=JSON.parse(readFileSync(regular(path),'utf8')) as BackupEnvelope;
 if(!value||Object.keys(value).sort().join(',')!=='format,migrations,sha256,tables,version'||value.format!=='focus-postgresql-backup'||value.version!==1||!Array.isArray(value.migrations)||!value.tables||typeof value.tables!=='object'||Object.keys(value.tables).sort().join(',')!==[...RECOVERY_TABLES].sort().join(','))throw Error('Unsupported PostgreSQL backup envelope.');
 const {sha256,...payload}=value;
 if(typeof sha256!=='string'||sha256!==hash(JSON.stringify(payload)))throw Error('PostgreSQL backup checksum mismatch.');
 for(const table of RECOVERY_TABLES){if(!Array.isArray(value.tables[table]))throw Error('Invalid backup collection.');for(const row of value.tables[table]){if(!row||Array.isArray(row)||typeof row!=='object'||Object.values(row).some(cell=>cell!==null&&typeof cell!=='string'&&(typeof cell!=='number'||!Number.isFinite(cell))))throw Error('Invalid backup cell.');}}
 return value;
}
async function migrations(db:Database){return db.all('SELECT version,name,checksum FROM schema_migrations ORDER BY version');}
async function columns(db:Database,table:string){return db.all('SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position',[table]);}
export async function assertEmptyPostgres(db:Database){
 await db.query('SELECT pg_advisory_xact_lock($1)',[POSTGRES_DATA_LOCK]);
 await db.query(`LOCK TABLE ${RECOVERY_TABLES.join(',')} IN ACCESS EXCLUSIVE MODE`);
 for(const table of RECOVERY_TABLES){const row=await db.one(`SELECT count(*)::integer AS n FROM ${table}`);if(Number(row?.n)!==0)throw Error('Destination must be an empty migrated PostgreSQL database; nothing was overwritten.');}
}
export async function resequencePostgres(db:Database){for(const table of ordered)await db.query(`SELECT setval(pg_get_serial_sequence('${table}','storage_order'),GREATEST(COALESCE((SELECT max(storage_order) FROM ${table}),1),1),COALESCE((SELECT max(storage_order)>=1 FROM ${table}),false))`);}
export function verifyPostgresBackup(path:string){return report(parseBackup(path));}
/** Complete application-data snapshot, including credentials. Not a native pg_dump or a provider backup. */
export async function backupPostgres(db:Database,outputPath:string):Promise<PostgresRecoveryReport>{
 const target=resolve(outputPath);try{lstatSync(target);throw Error('Backup target already exists.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 mkdirSync(dirname(target),{recursive:true,mode:0o700});if(realpathSync(dirname(target))!==dirname(target))throw Error('Backup destination must not traverse symlinks.');
 const value=await transaction(db,async()=>{
  await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables:Record<string,DataRow[]>={};for(const table of RECOVERY_TABLES)tables[table]=await db.all(`SELECT * FROM ${table} ORDER BY ${ordered.has(table)?'storage_order':table==='workspace_members'?'workspace_id,user_id':table==='idempotency_keys'?'workspace_id,request_id':table==='sessions'?'id_hash':'id'}`);
  const payload:BackupPayload={format:'focus-postgresql-backup',version:1,migrations:await migrations(db),tables};return {...payload,sha256:hash(JSON.stringify(payload))};
 });
 const temporary=join(dirname(target),`.focus-backup-${randomUUID()}.json`);let fd:number|undefined;
 try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);closeSync(fd);fd=undefined;linkSync(temporary,target);unlinkSync(temporary);return report(value);}finally{if(fd!==undefined)closeSync(fd);rmSync(temporary,{force:true});}
}
/** No SQL is accepted from the file. All cells pass schema/type validation and parameterized inserts. */
export async function restorePostgres(db:Database,sourcePath:string):Promise<PostgresRecoveryReport>{
 const backup=parseBackup(sourcePath);
 return transaction(db,async()=>{
  await assertEmptyPostgres(db);
  if(JSON.stringify(await migrations(db))!==JSON.stringify(backup.migrations))throw Error('Backup and destination migration versions/checksums differ.');
  await db.query('SET CONSTRAINTS ALL DEFERRED');
  for(const table of RECOVERY_TABLES){
   const schema=await columns(db,table),names=schema.map(column=>String(column.column_name));
   for(const row of backup.tables[table]){
    if(Object.keys(row).sort().join(',')!==[...names].sort().join(','))throw Error('Backup columns do not match the migrated destination.');
    for(const column of schema){const cell=row[String(column.column_name)],numeric=['integer','bigint','double precision','real','numeric'].includes(String(column.data_type));if(cell===null?column.is_nullable==='NO':column.data_type==='bigint'?!(typeof cell==='string'&&/^-?[0-9]+$/.test(cell)):numeric?typeof cell!=='number':typeof cell!=='string')throw Error('Backup cell does not match the migrated column type.');}
    if(table!=='sessions')await db.query(`INSERT INTO ${table} (${names.map(name=>`"${name}"`).join(',')}) VALUES (${names.map((_,index)=>`$${index+1}`).join(',')})`,names.map(name=>row[name]));
   }
  }
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');await resequencePostgres(db);
  const result=report(backup);result.sessionsRevoked=result.counts.sessions;result.counts.sessions=0;
  for(const table of RECOVERY_TABLES){const actual=await db.one(`SELECT count(*)::integer AS n FROM ${table}`);if(Number(actual?.n)!==result.counts[table])throw Error('Restored row counts differ; transaction rolled back.');}
  return result;
 });
}
