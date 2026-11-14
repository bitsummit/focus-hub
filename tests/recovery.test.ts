import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,scryptSync,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../scripts/database.ts',import.meta.url));
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
import {openDatabase} from '../server/legacy-sqlite.ts';
import {verifyPassword} from '../server/auth.ts';

import {backupDatabase,verifyDatabase,restoreDatabase,RECOVERY_TABLES} from '../server/recovery.ts';
function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return `scrypt-v2:32768:8:3:${salt}:${scryptSync(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex')}`;}
function fixture(){
 const previous=process.cwd(),dir=mkdtempSync(join(tmpdir(),'focus-recovery-')),source=join(dir,'source.sqlite'),db=openDatabase(source);process.chdir(dir);
 const now='2026-10-16T00:00:00.000Z';
 db.prepare('INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES(?,?,?,?,?)').run('u','recovery@example.test',hashPassword('Fictional-backup-password-42'),'Fictional',now);
 db.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('w','Fictional','u',now);
 db.prepare('INSERT INTO workspace_members VALUES(?,?,?,?)').run('w','u','owner',now);
 db.prepare('INSERT INTO strategic_goals(id,workspace_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('g','w','Meta ficticia',now,now);
 db.prepare('INSERT INTO projects(id,workspace_id,name,slug,goal_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('p','w','Proyecto ficticio','ficticio','g',now,now);
 db.prepare('INSERT INTO milestones(id,workspace_id,title,goal_id,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('m','w','Hito ficticio','g','p',now,now);
 for(const [id,title,deleted] of [['t','Tarea ficticia',null],['d','Borrada ficticia',now]])db.prepare('INSERT INTO tasks(id,workspace_id,title,project_id,created_by_user_id,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'w',title,'p','u',now,now,deleted);
 for(const [id,event] of [['e1','created'],['e2','completed'],['e3','reopened']])db.prepare('INSERT INTO task_events VALUES(?,?,?,?,?,?,?,?)').run(id,'w','t','u',event,null,JSON.stringify({status:event}),now);
 db.prepare('INSERT INTO journal_entries(id,workspace_id,author_user_id,entry_date,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('j','w','u','2026-10-16',now,now);
 db.prepare('INSERT INTO journal_blocks(id,workspace_id,journal_entry_id,block_type,task_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('b','w','j','task_reference','t',now,now);
 db.prepare('INSERT INTO focus_items VALUES(?,?,?,?,?,?,?,?)').run('f','w','u','t','weekly','2026-10-12',0,now);
 for(const id of ['request1','request2'])db.prepare('INSERT INTO idempotency_keys VALUES(?,?,?,?)').run('w',id,JSON.stringify({task_id:'t'}),now);
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('f'.repeat(64),'u','c'.repeat(64),'2030-01-01T00:00:00.000Z',now);
 const snapshot=(connection:DatabaseSync)=>Object.fromEntries(RECOVERY_TABLES.filter(table=>table!=='sessions').map(table=>[table,connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
 const domain={snapshot:()=>snapshot(db)};
 return {dir,source,db,domain,snapshot,close(){db.close();process.chdir(previous);rmSync(dir,{recursive:true,force:true});}};
}
test('recovery: committed WAL snapshot, full canonical graph and unchanged source survive verified restore',async()=>{
 const f=fixture();try{
  const snapshot=f.domain.snapshot(),target=join(f.dir,'backup.sqlite');
  const report=await backupDatabase(f.source,target);assert.deepEqual(Object.keys(report.counts).sort(),[...RECOVERY_TABLES].sort());
  assert.equal(report.counts.tasks,2);assert.equal(report.counts.sessions,1);assert.equal(statSync(target).mode&0o777,0o600);
  const restored=join(f.dir,'restored.sqlite'),result=await restoreDatabase(target,restored);assert.equal(result.sessionsRevoked,1);assert.equal(result.counts.sessions,0);
  const db=new DatabaseSync(restored);try{
   const user=db.prepare('SELECT * FROM users').get()!;assert.ok(verifyPassword('Fictional-backup-password-42',String(user.password_hash)));
   const recovered=f.snapshot(db);assert.deepEqual(recovered,snapshot);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM idempotency_keys').get()!.n,2);
  }finally{db.close();}
  assert.deepEqual(f.domain.snapshot(),snapshot);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get()!.n,1);
  assert.equal(verifyDatabase(target).mainFileSha256,report.mainFileSha256);
 }finally{f.close();}
});
test('recovery: uncommitted writes are excluded from WAL snapshot',async()=>{
 const f=fixture();try{f.db.exec('BEGIN IMMEDIATE');f.db.prepare('UPDATE tasks SET title=?').run('Uncommitted');
  const target=join(f.dir,'backup.sqlite');await backupDatabase(f.source,target);const db=new DatabaseSync(target,{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE title=?').get('Uncommitted')!.n,0);}finally{db.close();}
  f.db.exec('ROLLBACK');
 }finally{f.close();}
});
test('recovery: existing files, aliases, symlinks and orphan sidecars are never overwritten',async()=>{
 const f=fixture();try{
  const target=join(f.dir,'keep.sqlite');writeFileSync(target,'preserve');
  await assert.rejects(backupDatabase(f.source,target));assert.equal(readFileSync(target,'utf8'),'preserve');
  await assert.rejects(restoreDatabase(f.source,f.source));
  const linked=join(f.dir,'link.sqlite');symlinkSync(f.source,linked);await assert.rejects(backupDatabase(linked,join(f.dir,'bad.sqlite')));await assert.rejects(backupDatabase(f.source,linked));
  const side=join(f.dir,'side.sqlite');writeFileSync(side+'-wal','keep');await assert.rejects(backupDatabase(f.source,side));assert.equal(readFileSync(side+'-wal','utf8'),'keep');
 }finally{f.close();}
});
test('recovery: corruption, incompatible schema and broken foreign keys fail closed',async()=>{
 const f=fixture();try{
  const corrupt=join(f.dir,'corrupt.sqlite');writeFileSync(corrupt,'not sqlite');assert.throws(()=>verifyDatabase(corrupt));
  const empty=join(f.dir,'empty.sqlite'),db=new DatabaseSync(empty);db.exec('CREATE TABLE fake(id TEXT)');db.close();assert.throws(()=>verifyDatabase(empty),/Esquema/);
  const broken=join(f.dir,'broken.sqlite');await backupDatabase(f.source,broken);const bad=new DatabaseSync(broken);bad.exec("PRAGMA foreign_keys=OFF; UPDATE tasks SET project_id='missing'");bad.close();assert.throws(()=>verifyDatabase(broken),/relaciones/);
  await assert.rejects(restoreDatabase(broken,join(f.dir,'never.sqlite')));
 }finally{f.close();}
});

test('recovery: recorded live process blocks restore without signalling it',async()=>{
 const f=fixture();try{mkdirSync(join(f.dir,'.data'));writeFileSync(join(f.dir,'.data/codespaces-server.pid'),JSON.stringify({pid:process.pid}));
  await assert.rejects(restoreDatabase(f.source,join(f.dir,'blocked.sqlite')),/proceso gestionado activo/);assert.doesNotThrow(()=>process.kill(process.pid,0));
 }finally{f.close();}
});
test('recovery: CLI backup verify restore emits counts only and retains domain history',async()=>{
 const f=fixture();try{
  const backup=join(f.dir,'cli.sqlite'),restored=join(f.dir,'cli-restored.sqlite');
  for(const args of [['backup','--source',f.source,'--out',backup],['verify','--source',backup],['restore','--source',backup,'--out',restored]]){
   const result=spawnSync(process.execPath,['--import',loader,cli,...args],{cwd:f.dir,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.trim(),JSON.stringify({status:result.status,stderr:result.stderr,args}));const report=JSON.parse(result.stdout);assert.equal(report.counts.tasks,2);assert.equal(report.integrity,'ok');assert.ok(!result.stdout.includes('Tarea ficticia'));assert.ok(!result.stdout.includes('password_hash'));
  }
 }finally{f.close();}
});
