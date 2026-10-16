import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {openDatabase} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';
import {createApp} from '../server/app.ts';
import {backupDatabase,verifyDatabase,restoreDatabase,RECOVERY_TABLES} from '../server/recovery.ts';

const password='Fictional-Language-Test-2026!';
function rows(db:DatabaseSync,omitLanguage=false){return Object.fromEntries(RECOVERY_TABLES.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>{if(table==='users'&&omitLanguage){const {language,...legacy}=row;return legacy;}return {...row};})]));}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'focus-language-')),path=join(dir,'current.sqlite'),db=openDatabase(path);
 const a=createOwner(db,{email:'language-a@example.test',password}),b=createOwner(db,{email:'language-b@example.test',password});
 const context=(id:string)=>({user_id:id,workspace_id:String(db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id=?').get(id)!.workspace_id)});
 const domain=new Domain(db,context(a.id));const goal=domain.createEntity('goals',{title:'Meta ficticia'}),project=domain.createEntity('projects',{name:'Proyecto ficticio',goal_id:goal.id});
 const milestone=domain.createEntity('milestones',{title:'Hito ficticio',project_id:project.id,goal_id:goal.id});domain.updateEntity('milestones',milestone.id,{status:'achieved'});
 const task=domain.capture({text:'Tarea ficticia de idioma',request_id:randomUUID(),project_id:project.id,journal_date:'2026-10-16'});domain.updateTask(task.id,{status:'completed'});domain.updateTask(task.id,{status:'pending'});domain.setFocus('weekly','2026-10-12',[task.id]);
 const deleted=domain.capture({text:'Borrada ficticia',request_id:randomUUID()});domain.deleteTask(deleted.id);
 db.prepare("UPDATE users SET timezone='America/New_York',theme='dark',preferred_task_view='table',week_start_day=0 WHERE id=?").run(a.id);
 return {dir,path,db,a,b,context,domain,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
function legacyCopy(db:DatabaseSync,path:string){
 const legacy=new DatabaseSync(path);legacy.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));legacy.exec('PRAGMA foreign_keys=OFF; BEGIN');
 try{for(const [table,records] of Object.entries(rows(db,true)))for(const record of records){const keys=Object.keys(record);legacy.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>record[key]));}legacy.exec('COMMIT');}finally{legacy.close();}
}
test('language migration: complete legacy graph, historical dates and preferences survive additive reopen',()=>{
 const f=fixture();try{const path=join(f.dir,'legacy.sqlite');legacyCopy(f.db,path);const original=new DatabaseSync(path,{readOnly:true});const before=rows(original);original.close();
  assert.equal(verifyDatabase(path).schemaVersion,1);
  const migrated=openDatabase(path);try{assert.deepEqual(rows(migrated,true),before);assert.equal(migrated.prepare('SELECT language FROM users WHERE id=?').get(f.a.id)!.language,'es');assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length,0);}finally{migrated.close();}
  assert.equal(verifyDatabase(path).schemaVersion,2);
  const again=openDatabase(path);try{assert.deepEqual(rows(again,true),before);assert.equal(again.prepare('PRAGMA table_info(users)').all().filter(column=>column.name==='language').length,1);}finally{again.close();}
 }finally{f.close();}
});
test('language migration: database constraint admits only es/en and preserves accounts on invalid update',()=>{
 const f=fixture();try{for(const value of ['en','es']){f.db.prepare('UPDATE users SET language=? WHERE id=?').run(value,f.a.id);assert.equal(f.db.prepare('SELECT language FROM users WHERE id=?').get(f.a.id)!.language,value);}
  for(const value of ['fr','EN','',null])assert.throws(()=>f.db.prepare('UPDATE users SET language=? WHERE id=?').run(value,f.a.id));
  assert.equal(f.db.prepare('SELECT language FROM users WHERE id=?').get(f.a.id)!.language,'es');assert.equal(f.db.prepare('SELECT language FROM users WHERE id=?').get(f.b.id)!.language,'es');
 }finally{f.close();}
});
test('language migration: legacy backup/restore stays readonly and upgrades only on normal database open',async()=>{
 const f=fixture(),previous=process.cwd();try{process.chdir(f.dir);const source=join(f.dir,'legacy.sqlite'),backup=join(f.dir,'legacy-backup.sqlite'),restored=join(f.dir,'legacy-restored.sqlite');legacyCopy(f.db,source);
  assert.equal((await backupDatabase(source,backup)).schemaVersion,1);assert.equal((await restoreDatabase(backup,restored)).schemaVersion,1);assert.equal(verifyDatabase(source).schemaVersion,1);assert.equal(verifyDatabase(backup).schemaVersion,1);
  const db=openDatabase(restored);try{assert.equal(db.prepare('SELECT language FROM users WHERE id=?').get(f.a.id)!.language,'es');assert.deepEqual(rows(db,true),rows(f.db,true));}finally{db.close();}assert.equal(verifyDatabase(restored).schemaVersion,2);
 }finally{process.chdir(previous);f.close();}
});
test('language preference API: authorized per-user persistence, validation and exported preference',async()=>{
 const f=fixture();const server=createApp(f.db).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('Missing address');const base=`http://127.0.0.1:${address.port}`;
 try{
  const challenge=await fetch(base+'/api/session/challenge'),{loginToken}=await challenge.json(),cookie=challenge.headers.get('set-cookie')!.split(';')[0];
  const login=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-Login-CSRF':loginToken},body:JSON.stringify({email:'language-a@example.test',password})});assert.equal(login.status,200);const session=await login.json(),sessionCookie=login.headers.get('set-cookie')!.split(';')[0];
  const headers={'Content-Type':'application/json',Origin:base,Cookie:sessionCookie,'X-CSRF-Token':session.csrfToken};
  const response=await fetch(base+'/api/preferences',{method:'PATCH',headers,body:JSON.stringify({language:'en'})});assert.equal(response.status,200);assert.equal(f.db.prepare('SELECT language FROM users WHERE id=?').get(f.a.id)!.language,'en');assert.equal(f.db.prepare('SELECT language FROM users WHERE id=?').get(f.b.id)!.language,'es');
  const snapshot=await(await fetch(base+'/api/state',{headers})).json();assert.equal(snapshot.user.language,'en');const exported=await(await fetch(base+'/api/export',{headers})).json();assert.equal(exported.user.language,'en');
  for(const language of ['fr','EN','',null,3])assert.equal((await fetch(base+'/api/preferences',{method:'PATCH',headers,body:JSON.stringify({language})})).status,400);
  assert.equal((await fetch(base+'/api/preferences',{method:'PATCH',headers,body:JSON.stringify({language:'es',user_id:f.b.id})})).status,400);
  assert.equal(f.db.prepare('SELECT language FROM users WHERE id=?').get(f.a.id)!.language,'en');
  const second=openDatabase(f.path);try{assert.equal(second.prepare('SELECT language FROM users WHERE id=?').get(f.a.id)!.language,'en');}finally{second.close();}
 }finally{await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));f.close();}
});
