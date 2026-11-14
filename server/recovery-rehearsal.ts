import {randomUUID} from 'node:crypto';
import {lstatSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDatabase,schemaName,type Database} from './db.ts';
import {RECOVERY_TABLES} from './data-tables.ts';
import {restorePostgres,verifyPostgresBackup} from './postgres-recovery.ts';

export interface RecoveryRehearsalReport {
 format:'focus-postgresql-rehearsal';version:1;integrity:'ok';databaseIdentity:string;
 backupSha256:string;counts:Record<string,number>;sessionsRevoked:number;
 verifiedAt:string;temporarySchemaRemoved:true;
}
const canonical=(rows:Record<string,unknown>[])=>JSON.stringify(rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort());

/** Explicit operational drill. It restores only into its own fresh schema and never changes source records. */
export async function rehearsePostgresRecovery(databaseUrl:string,sourceSchema:string,backupPath:string):Promise<RecoveryRehearsalReport>{
 if(!databaseUrl)throw Error('An explicit PostgreSQL connection is required for the recovery rehearsal.');
 const selectedSchema=schemaName(sourceSchema),sourceFile=resolve(backupPath),stat=lstatSync(sourceFile);
 if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(sourceFile)!==sourceFile)throw Error('The backup must be a regular file without symlink components.');
 const temporary=mkdtempSync(join(realpathSync(tmpdir()),'focus-recovery-rehearsal-'));
 const snapshot=join(temporary,'backup.json');
 let source:Database|undefined,target:Database|undefined,created=false,result:RecoveryRehearsalReport|undefined;
 const rehearsalSchema=`focus_recovery_${randomUUID().replaceAll('-','')}`;
 try{
  // One immutable private input copy prevents concurrent edits to the original
  // backup between verification, restore and cell comparison.
  writeFileSync(snapshot,readFileSync(sourceFile),{mode:0o600,flag:'wx'});
  const verified=verifyPostgresBackup(snapshot);
  const backup=JSON.parse(readFileSync(snapshot,'utf8')) as {tables:Record<string,Record<string,unknown>[]>};
  source=await openDatabase(databaseUrl,{schema:selectedSchema,max:1});
  if(rehearsalSchema===source.schema||!/^focus_recovery_[a-f0-9]{32}$/.test(rehearsalSchema))throw Error('Unsafe recovery schema.');
  // The identifier is generated internally, never accepted from backup or CLI.
  // A collision fails CREATE; created stays false, so cleanup cannot drop it.
  await source.query(`CREATE SCHEMA "${rehearsalSchema}"`);created=true;
  target=await openDatabase(databaseUrl,{schema:rehearsalSchema,migrate:true,max:1});
  const restored=await restorePostgres(target,snapshot);
  for(const table of RECOVERY_TABLES){
   const actual=await target.all(`SELECT * FROM ${table}`);
   const expected=table==='sessions'?[]:backup.tables[table];
   if(canonical(actual)!==canonical(expected))throw Error(`Recovery rehearsal cell verification failed for ${table}.`);
  }
  result={format:'focus-postgresql-rehearsal',version:1,integrity:'ok',databaseIdentity:source.identity,
   backupSha256:verified.sha256,counts:restored.counts,sessionsRevoked:restored.sessionsRevoked??0,
   verifiedAt:new Date().toISOString(),temporarySchemaRemoved:true};
 }finally{
  try{await target?.close();}
  finally{
   try{if(created&&source)await source.query(`DROP SCHEMA "${rehearsalSchema}" CASCADE`);}
   finally{try{await source?.close();}finally{rmSync(temporary,{recursive:true,force:true});}}
  }
 }
 if(!result)throw Error('Recovery rehearsal did not complete.');
 return result;
}
