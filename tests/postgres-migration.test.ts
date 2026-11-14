import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabase as sqliteDatabase} from '../server/legacy-sqlite.ts';
import {importSqliteDatabase} from '../server/sqlite-import.ts';
import {backupPostgres,restorePostgres,verifyPostgresBackup,POSTGRES_DATA_LOCK} from '../server/postgres-recovery.ts';
import {RECOVERY_TABLES,backupDatabase} from '../server/recovery.ts';
import {createTestDatabase} from './postgres-fixture.ts';

function sqliteFixture(){
 const dir=mkdtempSync(join(tmpdir(),'focus-transfer-')),source=join(dir,'source.sqlite'),db=sqliteDatabase(source),now='2026-10-25T01:30:00.000Z';
 db.prepare('INSERT INTO users(id,email,password_hash,display_name,language,created_at) VALUES(?,?,?,?,?,?)').run('u','fictional@example.test','unchanged-test-hash','Fictional','en',now);
 db.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('w','Fictional','u',now);db.prepare('INSERT INTO workspace_members VALUES(?,?,?,?)').run('w','u','owner',now);
 db.prepare('INSERT INTO strategic_goals(id,workspace_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('g','w','Goal',now,now);
 db.prepare('INSERT INTO projects(id,workspace_id,name,slug,goal_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('p','w','Project','fictional','g',now,now);
 db.prepare('INSERT INTO milestones(id,workspace_id,title,goal_id,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('m','w','Milestone','g','p',now,now);
 // A child precedes its parent physically, exercising deferred self-references and rowid fidelity.
 db.exec('PRAGMA foreign_keys=OFF');
 for(const [id,parent,status] of [['child','parent','pending'],['parent',null,'completed']])db.prepare('INSERT INTO tasks(rowid,id,workspace_id,title,project_id,parent_task_id,status,created_by_user_id,tags,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id==='child'?-7:11,id,'w',id,'p',parent,status,'u','["ñ","tag"]','2026-10-25',now,now);
 db.exec('PRAGMA foreign_keys=ON');
 db.prepare('UPDATE tasks SET sort_order=? WHERE id=?').run(0.123456789012345,'child');
 for(const [id,event] of [['e1','created'],['e2','completed'],['e3','reopened']])db.prepare('INSERT INTO task_events VALUES(?,?,?,?,?,?,?,?)').run(id,'w','parent','u',event,'null','{"value":"ñ"}',now);
 db.prepare('INSERT INTO journal_entries(id,workspace_id,author_user_id,entry_date,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('j','w','u','2026-10-25',3,now,now);
 db.prepare('INSERT INTO journal_blocks(id,workspace_id,journal_entry_id,block_type,task_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('b','w','j','task_reference','child',now,now);
 db.prepare('INSERT INTO focus_items VALUES(?,?,?,?,?,?,?,?)').run('f','w','u','parent','weekly','2026-10-19',0,now);
 db.prepare('INSERT INTO idempotency_keys VALUES(?,?,?,?)').run('w','request','{"task_id":"parent"}',now);
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('token-hash','u','csrf','2030-01-01T00:00:00.000Z',now);
 return {dir,source,db,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('PostgreSQL transfer: complete SQLite graph, IDs, physical ordering, history, preferences and source remain intact',async()=>{
 const source=sqliteFixture(),target=await createTestDatabase();
 try{const before=readFileSync(source.source),result=await importSqliteDatabase(source.source,target.db);assert.equal(result.sessionsRevoked,1);assert.equal(result.counts.sessions,0);assert.equal(result.sourceMainFileSha256,createHash('sha256').update(before).digest('hex'));assert.deepEqual(readFileSync(source.source),before);
 assert.deepEqual((await target.db.all('SELECT id,storage_order,parent_task_id,tags FROM tasks ORDER BY storage_order')).map(row=>({...row,storage_order:Number(row.storage_order)})),[{id:'child',storage_order:-7,parent_task_id:'parent',tags:'["ñ","tag"]'},{id:'parent',storage_order:11,parent_task_id:null,tags:'["ñ","tag"]'}]);
 assert.equal((await target.db.one("SELECT language FROM users WHERE id='u'"))?.language,'en');assert.equal((await target.db.one("SELECT revision FROM journal_entries WHERE id='j'"))?.revision,3);
 for(const table of RECOVERY_TABLES)assert.equal(Number((await target.db.one(`SELECT count(*)::integer AS n FROM ${table}`))?.n),result.counts[table]);
 await target.db.query("INSERT INTO tasks(id,workspace_id,title,created_by_user_id,created_at,updated_at) VALUES('next','w','Next','u','now','now')");assert.equal(Number((await target.db.one("SELECT storage_order FROM tasks WHERE id='next'"))?.storage_order),12);
 await assert.rejects(importSqliteDatabase(source.source,target.db),/empty/);
 }finally{source.close();await target.close();}
});
test('PostgreSQL transfer: bad schema and invalid cross-reference fail without partial writes',async()=>{
 const source=sqliteFixture(),target=await createTestDatabase();try{source.db.exec("PRAGMA foreign_keys=OFF; UPDATE tasks SET project_id='missing'");await assert.rejects(importSqliteDatabase(source.source,target.db),/foreign key/);assert.equal(Number((await target.db.one('SELECT count(*)::integer n FROM users'))?.n),0);
 source.db.exec('CREATE TABLE unknown(id TEXT)');await assert.rejects(importSqliteDatabase(source.source,target.db),/schema/);
 }finally{source.close();await target.close();}
});
test('PostgreSQL recovery: complete private snapshot restores atomically, revokes sessions and refuses overwrite',async()=>{
 const source=sqliteFixture(),original=await createTestDatabase(),restored=await createTestDatabase();try{
 await importSqliteDatabase(source.source,original.db);await original.db.query("INSERT INTO sessions VALUES('hash','u','csrf','2030','2026')");
 const path=join(source.dir,'backup.json'),report=await backupPostgres(original.db,path);assert.equal(report.counts.sessions,1);assert.equal(statSync(path).mode&0o777,0o600);assert.deepEqual(verifyPostgresBackup(path),report);assert.ok(!JSON.stringify(report).includes('unchanged-test-hash'));
 await assert.rejects(backupPostgres(original.db,path),/already exists/);const linked=join(source.dir,'symlink.json');symlinkSync(path,linked);assert.throws(()=>verifyPostgresBackup(linked),/symbolic/);
 const outcome=await restorePostgres(restored.db,path);assert.equal(outcome.sessionsRevoked,1);assert.equal(outcome.counts.sessions,0);
 for(const table of RECOVERY_TABLES){if(table==='sessions')continue;assert.deepEqual(await restored.db.all(`SELECT * FROM ${table}`),await original.db.all(`SELECT * FROM ${table}`));}
 await assert.rejects(restorePostgres(restored.db,path),/empty/);
 const tampered=join(source.dir,'tampered.json');writeFileSync(tampered,readFileSync(path,'utf8').replace('unchanged-test-hash','changed-test-hash'));assert.throws(()=>verifyPostgresBackup(tampered),/checksum/);
 }finally{source.close();await original.close();await restored.close();}
});
test('PostgreSQL recovery: structurally valid checksum with invalid FK rolls back all tables',async()=>{
 const source=sqliteFixture(),original=await createTestDatabase(),restored=await createTestDatabase();try{await importSqliteDatabase(source.source,original.db);const path=join(source.dir,'backup.json');await backupPostgres(original.db,path);const value=JSON.parse(readFileSync(path,'utf8'));value.tables.tasks[0].project_id='missing';delete value.sha256;value.sha256=createHash('sha256').update(JSON.stringify(value)).digest('hex');writeFileSync(path,JSON.stringify(value));await assert.rejects(restorePostgres(restored.db,path));for(const table of RECOVERY_TABLES)assert.equal(Number((await restored.db.one(`SELECT count(*)::integer n FROM ${table}`))?.n),0);
 }finally{source.close();await original.close();await restored.close();}
});
test('PostgreSQL transfer: original SQLite 001 schema receives Spanish default without modifying source',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-transfer-v1-')),source=join(dir,'v1.sqlite'),target=await createTestDatabase();
 const {DatabaseSync}=await import('node:sqlite');const sqlite=new DatabaseSync(source);
 try{sqlite.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));sqlite.prepare('INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES(?,?,?,?,?)').run('u','v1@example.test','original-hash','Fictional','2026');
 const before=readFileSync(source),report=await importSqliteDatabase(source,target.db);assert.equal(report.schemaVersion,1);assert.equal((await target.db.one("SELECT language FROM users WHERE id='u'"))?.language,'es');assert.deepEqual(readFileSync(source),before);assert.ok(!sqlite.prepare('PRAGMA table_info(users)').all().some(row=>row.name==='language'));
 }finally{sqlite.close();await target.close();rmSync(dir,{recursive:true,force:true});}
});
test('PostgreSQL transfer: PostgreSQL constraint failure after partial copy rolls back every inserted entity',async()=>{
 const source=sqliteFixture(),target=await createTestDatabase();try{
 // The original SQLite permits NUL in TEXT; PostgreSQL correctly refuses it rather than silently truncating data.
 source.db.prepare('UPDATE tasks SET title=? WHERE id=?').run('invalid\u0000title','parent');
 await assert.rejects(importSqliteDatabase(source.source,target.db));for(const table of RECOVERY_TABLES)assert.equal(Number((await target.db.one(`SELECT count(*)::integer n FROM ${table}`))?.n),0);
 }finally{source.close();await target.close();}
});

test('PostgreSQL transfer: committed WAL changes while awaiting the destination lock reject and roll back',async()=>{
 const source=sqliteFixture(),target=await createTestDatabase();
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 let locked!:()=>void;const lockReady=new Promise<void>(resolve=>{locked=resolve;});
 const blocker=target.db.transaction(async()=>{await target.db.query('SELECT pg_advisory_xact_lock($1)',[POSTGRES_DATA_LOCK]);locked();await gate;});
 let transfer:Promise<unknown>|undefined;
 try{
  await lockReady;
  const beforeMain=readFileSync(source.source),beforeWal=readFileSync(source.source+'-wal');
  transfer=importSqliteDatabase(source.source,target.db);
  // SQLite inspection is synchronous before the import awaits its PostgreSQL lock.
  // Yielding to the database confirms the migration is blocked, not already committed.
  let waiting=false;
  for(let attempt=0;attempt<100&&!waiting;attempt++){
   const row=await target.db.one("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory') AS waiting");
   waiting=Boolean(row?.waiting);if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(waiting,'import must wait on the explicit advisory lock');
  source.db.prepare('UPDATE tasks SET title=? WHERE id=?').run('Committed WAL change','parent');
  assert.deepEqual(readFileSync(source.source),beforeMain,'WAL commit does not change the main database');
  assert.notDeepEqual(readFileSync(source.source+'-wal'),beforeWal);
  release();await blocker;await assert.rejects(transfer,/WAL changed concurrently/);
  for(const table of RECOVERY_TABLES)assert.equal(Number((await target.db.one(`SELECT count(*)::integer n FROM ${table}`))?.n),0);
 }finally{release();await blocker;await transfer?.catch(()=>{});source.close();await target.close();}
});

test('PostgreSQL transfer: a closed verified SQLite backup imports with stable file fingerprints',async()=>{
 const source=sqliteFixture(),target=await createTestDatabase();
 try{const backup=join(source.dir,'closed-backup.sqlite');await backupDatabase(source.source,backup);
 const before=readFileSync(backup);assert.equal(existsSync(backup+'-wal'),false);
 const result=await importSqliteDatabase(backup,target.db);assert.equal(result.sourceFingerprintsMatched,true);assert.equal(result.sourceWalSha256,null);assert.equal(result.counts.tasks,2);assert.deepEqual(readFileSync(backup),before);assert.equal(existsSync(backup+'-wal'),false);assert.equal(existsSync(backup+'-shm'),false);
 }finally{source.close();await target.close();}
});
