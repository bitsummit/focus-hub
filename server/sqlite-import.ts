import { DatabaseSync } from 'node:sqlite';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RECOVERY_TABLES} from './recovery.ts';
import {transaction,type Database} from './db.ts';
import {assertEmptyPostgres,resequencePostgres} from './postgres-recovery.ts';

const ordered=new Set(['strategic_goals','projects','milestones','tasks','task_events','journal_entries','journal_blocks','focus_items']);
function sqliteSchema(db:DatabaseSync){return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row,sql:String(row.sql).replace(/\s+/g,' ').trim()})));}
const supportedSchemas=(()=>{const db=new DatabaseSync(':memory:');try{db.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));const v1=sqliteSchema(db);db.exec(readFileSync(new URL('../migrations/002_language.sql',import.meta.url),'utf8'));return [v1,sqliteSchema(db)];}finally{db.close();}})();
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export interface SqliteImportReport {schemaVersion:number;sourceMainFileSha256:string;sourceWalSha256:string|null;sourceFingerprintsMatched:true;counts:Record<string,number>;checksums:Record<string,string>;sessionsRevoked:number}
function sourceFingerprints(source:string){
 const main=lstatSync(source);if(!main.isFile()||main.isSymbolicLink()||realpathSync(source)!==source)throw Error('SQLite source must remain a regular file without symlinks.');
 let wal:string|null=null;
 try{const stat=lstatSync(source+'-wal');if(!stat.isFile()||stat.isSymbolicLink())throw Error('SQLite WAL must be a regular file without symlinks.');wal=digest(readFileSync(source+'-wal'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return {main:digest(readFileSync(source)),wal};
}
/** Explicit one-way copy. Import a closed backup or stop all source writers first.
 * Before/after fingerprints detect main/WAL changes; they cannot exclude a write
 * after the final check. No success report certifies the absence of a writer.
 */
export async function importSqliteDatabase(sourcePath:string,destination:Database):Promise<SqliteImportReport>{
 const source=resolve(sourcePath),stat=lstatSync(source);
 if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(source)!==source)throw Error('SQLite source must be a regular file without symlink components.');
 const before=sourceFingerprints(source);
 // SQLite may create empty WAL sidecars even when readOnly is set. A source
 // without a WAL is read immutably, avoiding those writes; an existing WAL must
 // instead be read normally so its committed records remain part of the snapshot.
 const uri=pathToFileURL(source);uri.searchParams.set('mode','ro');
 if(before.wal===null)uri.searchParams.set('immutable','1');
 const sqlite=new DatabaseSync(uri.href,{readOnly:true});
 try{
  sqlite.exec('PRAGMA trusted_schema=OFF; BEGIN');
  const version=supportedSchemas.indexOf(sqliteSchema(sqlite));
  if(version<0)throw Error('Unsupported SQLite schema; source has not been changed.');
  const integrity=sqlite.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok'||sqlite.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite integrity or foreign key validation failed.');
  const rows=new Map<string,Record<string,unknown>[]>(),counts:Record<string,number>={},checksums:Record<string,string>={};
  for(const table of RECOVERY_TABLES){
   const values=sqlite.prepare(`SELECT ${ordered.has(table)?'rowid AS storage_order, ':''}* FROM ${table} ORDER BY rowid`).all() as Record<string,unknown>[];
   if(table==='users'&&version===0)for(const value of values)value.language='es';
   rows.set(table,values);counts[table]=values.length;
   checksums[table]=digest(JSON.stringify(values));
  }
  const result=await transaction(destination,async()=>{
   await assertEmptyPostgres(destination);
   await destination.query('SET CONSTRAINTS ALL DEFERRED');
   for(const table of RECOVERY_TABLES){
    // Sessions are deliberately revoked. Password hashes and memberships are copied verbatim.
    if(table==='sessions')continue;
    for(const row of rows.get(table)!){const columns=Object.keys(row);await destination.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));}

   }
   await destination.query('SET CONSTRAINTS ALL IMMEDIATE');await resequencePostgres(destination);
   for(const table of RECOVERY_TABLES){if(table==='sessions')continue;const row=await destination.one(`SELECT count(*)::integer AS n FROM ${table}`);if(Number(row?.n)!==counts[table])throw Error('PostgreSQL row count verification failed.');
    const actual=await destination.all(`SELECT * FROM ${table} ORDER BY ${ordered.has(table)?'storage_order':table==='workspace_members'?'workspace_id,user_id':table==='idempotency_keys'?'workspace_id,request_id':'id'}`);
    // Compare canonical cells independent of driver/object property ordering.
    const canonical=(values:Record<string,unknown>[])=>JSON.stringify(values.map(value=>Object.fromEntries(Object.entries(value).map(([key,cell])=>[key,key==='storage_order'?String(cell):cell] as [string,unknown]).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if(canonical(actual)!==canonical(rows.get(table)!))throw Error('PostgreSQL cell fidelity verification failed.');
   }
   if(JSON.stringify(before)!==JSON.stringify(sourceFingerprints(source)))throw Error('SQLite main file or WAL changed concurrently; destination rolled back. Stop source writers and import a closed backup.');
   return {schemaVersion:version+1,sourceMainFileSha256:before.main,sourceWalSha256:before.wal,sourceFingerprintsMatched:true as const,counts:{...counts,sessions:0},checksums,sessionsRevoked:counts.sessions};
  });
  sqlite.exec('COMMIT');return result;
 }finally{try{sqlite.exec('ROLLBACK');}catch{}sqlite.close();}
}
