import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../scripts/database.ts',import.meta.url));
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
import {openDatabase} from '../server/db.ts';
import {createOwner,verifyPassword} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';
import {backupDatabase,verifyDatabase,restoreDatabase,RECOVERY_TABLES} from '../server/recovery.ts';
function fixture(){
 const previous=process.cwd(),dir=mkdtempSync(join(tmpdir(),'focus-recovery-')),source=join(dir,'source.sqlite'),db=openDatabase(source);process.chdir(dir);
 const owner=createOwner(db,{email:'recovery@example.test',password:'Fictional-backup-password-42'});
 const ws=db.prepare('SELECT id FROM workspaces').get()!;
 const domain=new Domain(db,{user_id:owner.id,workspace_id:String(ws.id)});
 domain.createEntity('goals',{title:'Meta ficticia'});const goal=domain.snapshot().goals[0];
 domain.createEntity('projects',{name:'Proyecto ficticio',goal_id:goal.id});const project=domain.snapshot().projects[0];
 domain.createEntity('milestones',{title:'Hito ficticio',goal_id:goal.id,project_id:project.id});
 const task=domain.capture({text:'Tarea ficticia',request_id:randomUUID(),project_id:project.id,journal_date:'2026-10-16'});
 domain.updateTask(task.id,{status:'completed'});domain.updateTask(task.id,{status:'pending'});
 domain.setFocus('weekly','2026-10-12',[task.id]);
 const deleted=domain.capture({text:'Borrada ficticia',request_id:randomUUID()});domain.deleteTask(deleted.id);
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run('f'.repeat(64),owner.id,'c'.repeat(64),'2030-01-01T00:00:00.000Z','2026-10-16T00:00:00.000Z');
 return {dir,source,db,domain,close(){db.close();process.chdir(previous);rmSync(dir,{recursive:true,force:true});}};
}
test('recovery: committed WAL snapshot, full canonical graph and unchanged source survive verified restore',async()=>{
 const f=fixture();try{
  const snapshot=f.domain.snapshot(),target=join(f.dir,'backup.sqlite');
  const report=await backupDatabase(f.source,target);assert.deepEqual(Object.keys(report.counts).sort(),[...RECOVERY_TABLES].sort());
  assert.equal(report.counts.tasks,2);assert.equal(report.counts.sessions,1);assert.equal(statSync(target).mode&0o777,0o600);
  const restored=join(f.dir,'restored.sqlite'),result=await restoreDatabase(target,restored);assert.equal(result.sessionsRevoked,1);assert.equal(result.counts.sessions,0);
  const db=new DatabaseSync(restored);try{
   const user=db.prepare('SELECT * FROM users').get()!;assert.ok(verifyPassword('Fictional-backup-password-42',String(user.password_hash)));
   const recovered=new Domain(db,{user_id:String(user.id),workspace_id:snapshot.workspace.id}).snapshot();assert.deepEqual(recovered,snapshot);
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
   const result=spawnSync(process.execPath,['--import',loader,cli,...args],{cwd:f.dir,encoding:'utf8'});assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.counts.tasks,2);assert.equal(report.integrity,'ok');assert.ok(!result.stdout.includes('Tarea ficticia'));assert.ok(!result.stdout.includes('password_hash'));
  }
 }finally{f.close();}
});
