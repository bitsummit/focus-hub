import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createApp} from '../server/app.js';
import {createOwner} from '../server/auth.js';
import type {Snapshot} from '../shared/contracts.js';

const password='Fictional-QA-password-2026!';
async function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'focus-hub-qa-'));const path=join(dir,'test.sqlite');const db=openDatabase(path);
 await createOwner(db,{email:'a@example.test',password,display_name:'Persona ficticia A'});
 await createOwner(db,{email:'b@example.test',password,display_name:'Persona ficticia B'});
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw Error('Missing address');
 const base=`http://127.0.0.1:${address.port}`;
 async function login(email:string) {
  const r=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email,password})});assert.equal(r.status,200,await r.clone().text());
  const session=await r.json();const cookie=r.headers.get('set-cookie')!.split(';')[0];
  async function request(method:string,url:string,data?:unknown,extra:Record<string,string>={}) {
   return fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base,'X-CSRF-Token':session.csrfToken,...extra},body:data===undefined?undefined:JSON.stringify(data)});
  }
  async function ok(method:string,url:string,data?:unknown):Promise<any>{const r=await request(method,url,data);assert.ok(r.ok,`${method} ${url}: ${r.status} ${await r.clone().text()}`);return r.json();}
  return {request,ok,cookie};
 }
 return {db,path,base,login,close:async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();rmSync(dir,{recursive:true,force:true});}};
}
function newTask(state:Snapshot,title:string){const task=state.tasks.find(t=>t.title===title);assert.ok(task,`Task ${title} missing`);return task;}
test('01,05,06: capture is idempotent, durable across connections, completion and reopening preserve audited history',async()=>{
 const f=await fixture();try {const a=await f.login('a@example.test');const request_id=randomUUID();
 let state=await a.ok('POST','/api/tasks',{text:'Preparar presentación',request_id});const task=newTask(state,'Preparar presentación');
 state=await a.ok('POST','/api/tasks',{text:'Preparar presentación',request_id});assert.equal(state.tasks.length,1);assert.equal(state.events.filter((e:any)=>e.event_type==='created').length,1);
 const reopenedDb=openDatabase(f.path);assert.equal((reopenedDb.prepare('SELECT title FROM tasks WHERE id=?').get(task.id) as any).title,task.title);reopenedDb.close();
 state=await a.ok('PATCH',`/api/tasks/${task.id}`,{status:'completed'});assert.ok(newTask(state,task.title).completed_at);assert.equal(state.events.filter((e:any)=>e.event_type==='completed').length,1);
 state=await a.ok('PATCH',`/api/tasks/${task.id}`,{status:'completed'});assert.equal(state.events.filter((e:any)=>e.event_type==='completed').length,1);
 state=await a.ok('PATCH',`/api/tasks/${task.id}`,{status:'pending'});assert.equal(newTask(state,task.title).completed_at,null);assert.equal(state.events.filter((e:any)=>e.event_type==='completed').length,1);assert.equal(state.events.filter((e:any)=>e.event_type==='reopened').length,1);
 state=await a.ok('PATCH',`/api/tasks/${task.id}`,{status:'completed'});
 const year=new Date().getUTCFullYear();const analytics=await a.ok('GET',`/api/analytics?start=${year}-01-01&end=${year+1}-01-01`);assert.equal(analytics.created,1);assert.equal(analytics.completed,1);assert.equal(analytics.reopened,1);
 }finally{await f.close();}
});

test('02,03,04,07: journal project parsing, task references, revisions, nesting and synchronization',async()=>{
 const f=await fixture();try{const a=await f.login('a@example.test');let s=await a.ok('POST','/api/projects',{name:'SRA'});const project=s.projects[0];const date='2026-10-15';
 s=await a.ok('POST',`/api/journals/${date}/blocks`,{text:'# SRA',request_id:randomUUID(),revision:0});
 s=await a.ok('POST',`/api/journals/${date}/blocks`,{text:'Notas ficticias del día',request_id:randomUUID(),revision:1});
 const request_id=randomUUID();const append={text:'- [ ] !! Preparar presentación #SRA',request_id,revision:2};
 s=await a.ok('POST',`/api/journals/${date}/blocks`,append);const task=newTask(s,'Preparar presentación');assert.equal(task.priority,'critical');assert.equal(task.project_id,project.id);
 s=await a.ok('POST',`/api/journals/${date}/blocks`,append);assert.equal(s.tasks.length,1);assert.equal(s.blocks.filter((b:any)=>b.task_id===task.id).length,1);
 const stale=await a.request('POST',`/api/journals/${date}/blocks`,{text:'Conflicto',request_id:randomUUID(),revision:0});assert.equal(stale.status,409);
 s=await a.ok('POST',`/api/journals/${date}/blocks`,{text:'- [ ] Subtarea ficticia',request_id:randomUUID(),revision:3,indent_level:1});const sub=newTask(s,'Subtarea ficticia');assert.equal(sub.parent_task_id,task.id);assert.equal(sub.project_id,project.id);
 assert.equal((await a.request('PATCH',`/api/tasks/${task.id}`,{parent_task_id:sub.id})).status,400);
 assert.equal((await a.request('POST',`/api/journals/${date}/blocks`,{...append,text:'- [ ] Otro contenido'})).status,409);
 for(const status of ['in_progress','pending_review','waiting_external'])s=await a.ok('PATCH',`/api/tasks/${task.id}`,{status,waiting_on:'Revisión ficticia',follow_up_at:'2026-10-20'});
 s=await a.ok('GET','/api/state');assert.equal(newTask(s,task.title).status,'waiting_external');assert.equal(newTask(s,task.title).follow_up_at,'2026-10-20');assert.equal(s.blocks.find((b:any)=>b.task_id===task.id).task_id,task.id);assert.equal(s.journals[0].entry_date,date);
 const block=s.blocks.find((b:any)=>b.task_id===task.id);await a.ok('DELETE',`/api/blocks/${block.id}`,{revision:s.journals[0].revision});s=await a.ok('GET','/api/state');assert.equal(s.tasks.length,2);assert.ok(s.blocks.some((b:any)=>b.text_content==='Notas ficticias del día'));
 }finally{await f.close();}
});

test('08,09,12: ordered period focus, independent milestones and full-fidelity exports',async()=>{
 const f=await fixture();try{const a=await f.login('a@example.test');let s=await a.ok('POST','/api/tasks',{text:'Primera',request_id:randomUUID()});const one=newTask(s,'Primera');s=await a.ok('POST','/api/tasks',{text:'Segunda',request_id:randomUUID()});const two=newTask(s,'Segunda');
 await a.ok('PUT','/api/focus/weekly/2026-10-12',{task_ids:[two.id,one.id]});await a.ok('PUT','/api/focus/daily/2026-10-16',{task_ids:[one.id]});s=await a.ok('GET','/api/state');assert.deepEqual(s.focus.filter((x:any)=>x.period_type==='weekly').sort((a:any,b:any)=>a.sort_order-b.sort_order).map((x:any)=>x.task_id),[two.id,one.id]);
 await a.ok('PATCH',`/api/tasks/${one.id}`,{status:'completed'});await a.ok('PUT','/api/focus/weekly/2026-10-12',{task_ids:[one.id,two.id]});assert.equal((await a.request('PUT','/api/focus/weekly/2026-10-19',{task_ids:[one.id]})).status,400);await a.ok('PATCH',`/api/tasks/${one.id}`,{status:'pending'});
 s=await a.ok('POST','/api/goals',{title:'Objetivo ficticio'});const goal=s.goals[0];s=await a.ok('POST','/api/milestones',{title:'Resultado comprobable',goal_id:goal.id});const milestone=s.milestones[0];s=await a.ok('PATCH',`/api/milestones/${milestone.id}`,{status:'achieved'});assert.ok(s.milestones[0].achieved_at);assert.equal(s.tasks.filter((t:any)=>t.status==='completed').length,0);
 const exported=await a.ok('GET','/api/export?format=json');assert.ok(exported.schemaVersion);const serialized=JSON.stringify(exported);for(const id of [one.id,two.id,goal.id,milestone.id])assert.ok(serialized.includes(id));for(const key of ['tasks','events','blocks','journals','focus','projects','goals','milestones'])assert.ok(serialized.includes(`"${key}"`),`missing ${key}`);
 await a.ok('POST','/api/tasks',{text:'=FORMULA',request_id:randomUUID()});const csv=await a.request('GET','/api/export?format=csv');assert.equal(csv.status,200);const contents=await csv.text();assert.ok(contents.includes(one.id));assert.ok(contents.includes("'=FORMULA"));
 }finally{await f.close();}
});

test('13: authentication, logout, CSRF, origin checks and cross-tenant IDs/relations',async()=>{
 const f=await fixture();try{assert.equal((await fetch(f.base+'/api/state')).status,401);const a=await f.login('a@example.test'),b=await f.login('b@example.test');
 let s=await b.ok('POST','/api/projects',{name:'Proyecto de B'});const project=s.projects[0];s=await b.ok('POST','/api/tasks',{text:'Privada B',request_id:randomUUID()});const task=newTask(s,'Privada B');
 s=await b.ok('POST','/api/goals',{title:'Meta privada B'});const goal=s.goals[0];s=await b.ok('POST','/api/milestones',{title:'Hito privado B',goal_id:goal.id});const milestone=s.milestones[0];
 s=await b.ok('POST','/api/journals/2026-10-16/blocks',{text:'Nota privada B',revision:0,request_id:randomUUID()});const block=s.blocks[0];
 assert.equal((await a.ok('GET','/api/state')).tasks.length,0);
 assert.equal((await a.request('GET',`/api/tasks/${task.id}/events`)).status,404);
 for(const [path,data] of [[`/api/projects/${project.id}`,{name:'Ataque'}],[`/api/goals/${goal.id}`,{title:'Ataque'}],[`/api/milestones/${milestone.id}`,{status:'achieved'}],[`/api/blocks/${block.id}`,{text_content:'Ataque',revision:1}]] as const)assert.equal((await a.request('PATCH',path,data)).status,404);
 assert.equal((await a.request('DELETE',`/api/blocks/${block.id}`,{revision:1})).status,404);
 assert.equal((await a.ok('GET','/api/journals/2026-10-16')).entry,null);
 for(const method of ['PATCH','DELETE']){const r=await a.request(method,`/api/tasks/${task.id}`,method==='PATCH'?{title:'Ataque'}:{});assert.ok([403,404].includes(r.status));}
 for(const input of [{text:'Ataque',project_id:project.id},{text:'Ataque',parent_task_id:task.id}]){const r=await a.request('POST','/api/tasks',{...input,request_id:randomUUID()});assert.ok([400,403,404,422].includes(r.status));}
 assert.ok([403,404].includes((await a.request('PUT','/api/focus/daily/2026-10-16',{task_ids:[task.id]})).status));
 const csrf=await a.request('POST','/api/tasks',{text:'No CSRF',request_id:randomUUID()},{'X-CSRF-Token':''});assert.equal(csrf.status,403);
 const origin=await a.request('POST','/api/tasks',{text:'Bad origin',request_id:randomUUID()},{Origin:'https://evil.example'});assert.equal(origin.status,403);
 const invalid=await b.request('PATCH',`/api/tasks/${task.id}`,{status:'invalid'});assert.ok([400,422].includes(invalid.status));
 s=await b.ok('GET','/api/state');assert.equal(newTask(s,'Privada B').title,'Privada B');
 const logout=await a.request('DELETE','/api/session');assert.ok(logout.ok);assert.equal((await a.request('GET','/api/state')).status,401);
 }finally{await f.close();}
});

test('10,11,12: verified historical events use local period bounds and remain in archive/export after soft deletion',async()=>{
 const f=await fixture();try{const a=await f.login('a@example.test');let s=await a.ok('POST','/api/tasks',{text:'Logro ficticio de septiembre',request_id:randomUUID()});const old=newTask(s,'Logro ficticio de septiembre');
 await a.ok('PATCH',`/api/tasks/${old.id}`,{status:'completed'});
 f.db.prepare("UPDATE tasks SET created_at='2026-09-20T10:00:00.000Z',completed_at='2026-09-21T10:00:00.000Z' WHERE id=?").run(old.id);
 f.db.prepare("UPDATE task_events SET occurred_at=CASE WHEN event_type='created' THEN '2026-09-20T10:00:00.000Z' ELSE '2026-09-21T10:00:00.000Z' END WHERE task_id=?").run(old.id);
 s=await a.ok('POST','/api/tasks',{text:'Captura al cruzar medianoche UTC',request_id:randomUUID()});const boundary=newTask(s,'Captura al cruzar medianoche UTC');
 f.db.prepare("UPDATE tasks SET created_at='2026-10-15T22:30:00.000Z' WHERE id=?").run(boundary.id);f.db.prepare("UPDATE task_events SET occurred_at='2026-10-15T22:30:00.000Z' WHERE task_id=?").run(boundary.id);
 const previous=await a.ok('GET','/api/analytics?start=2026-10-15&end=2026-10-16');assert.equal(previous.created,0);
 const localDay=await a.ok('GET','/api/analytics?start=2026-10-16&end=2026-10-17');assert.equal(localDay.created,1);
 const september=await a.ok('GET','/api/analytics?start=2026-09-21&end=2026-09-28');assert.equal(september.completed,1);assert.equal(september.achievements[0].task_id,old.id);
 s=await a.ok('GET','/api/state');assert.equal(newTask(s,old.title).completed_at,'2026-09-21T10:00:00.000Z');
 await a.ok('DELETE',`/api/tasks/${old.id}`);const exported=await a.ok('GET','/api/export?format=json');assert.ok(exported.tasks.some((t:any)=>t.id===old.id&&t.deleted_at));assert.ok(exported.events.some((e:any)=>e.task_id===old.id&&e.event_type==='completed'));
 }finally{await f.close();}
});
