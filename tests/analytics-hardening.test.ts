import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {openDatabase,transaction} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';

function fixture(){
 const db=openDatabase(':memory:');
 const user=createOwner(db,{email:'analytics-hardening@example.test',password:'Fictional-analytics-test-password'});
 const workspace=String(db.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(user.id)!.id);
 const domain=new Domain(db,{user_id:user.id,workspace_id:workspace});
 const insertTask=db.prepare('INSERT INTO tasks(id,workspace_id,title,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)');
 const insertEvent=db.prepare('INSERT INTO task_events(id,workspace_id,task_id,actor_user_id,event_type,to_value_json,occurred_at) VALUES(?,?,?,?,?,?,?)');
 function task(time:string){const id=randomUUID();insertTask.run(id,workspace,'Tarea ficticia',user.id,time,time);return id;}
 function event(id:string,type:string,time:string,value:unknown=null){insertEvent.run(randomUUID(),workspace,id,user.id,type,JSON.stringify(value),time);}
 return {db,domain,task,event};
}

test('Analytics retains exclusive local boundaries, DST days and distinct task counting across re-completions',()=>{
 const f=fixture();try{
  // In Madrid the spring-transition day starts at 23:00Z and ends at 22:00Z.
  const first=f.task('2026-03-28T23:00:00.000Z');
  f.event(first,'created','2026-03-28T23:00:00.000Z',{status:'pending'});
  f.event(first,'status_changed','2026-03-29T01:30:00.000Z','completed');
  f.event(first,'completed','2026-03-29T01:30:00.000Z');
  f.event(first,'completed','2026-03-29T02:30:00.000Z');
  f.event(first,'reopened','2026-03-29T22:00:00.000Z');
  f.event(first,'status_changed','2026-03-29T22:00:00.000Z','pending');
  f.event(first,'status_changed','2026-03-30T10:00:00.000Z','completed');
  f.event(first,'completed','2026-03-30T10:00:00.000Z');
  const excluded=f.task('2026-03-28T22:59:59.999Z');
  f.event(excluded,'created','2026-03-28T22:59:59.999Z',{status:'pending'});
  const spring=f.domain.analytics('2026-03-29','2026-03-30');
  assert.deepEqual(spring.series,[{date:'2026-03-29',created:1,completed:1}]);
  assert.equal(spring.reopened,0);assert.equal(spring.ending_backlog,1);
  const range=f.domain.analytics('2026-03-29','2026-03-31');
  assert.deepEqual(range.series,[{date:'2026-03-29',created:1,completed:1},{date:'2026-03-30',created:0,completed:1}]);
  assert.equal(range.completed,1);assert.equal(range.reopened,1);assert.equal(range.achievements.length,1);
  // Both occurrences of the repeated autumn hour belong to one local day.
  const fall=f.task('2026-10-24T22:00:00.000Z');
  f.event(fall,'created','2026-10-24T22:00:00.000Z',{status:'pending'});
  f.event(fall,'completed','2026-10-25T00:30:00.000Z');
  f.event(fall,'completed','2026-10-25T01:30:00.000Z');
  f.event(fall,'completed','2026-10-25T23:00:00.000Z');
  assert.deepEqual(f.domain.analytics('2026-10-25','2026-10-26').series,[{date:'2026-10-25',created:1,completed:1}]);
 }finally{f.db.close();}
});

test('Three years of fictional history completes within a generous budget without multiplying events by days',()=>{
 const f=fixture();try{
  transaction(f.db,()=>{for(let i=0;i<3000;i++){
   const time=new Date(Date.UTC(2024,0,1)+i%1096*86400000+12*3600000).toISOString();
   const id=f.task(time);f.event(id,'created',time,{status:'pending'});
   f.event(id,'priority_changed',time,'high');f.event(id,'status_changed',time,'completed');f.event(id,'completed',time);
  }});
  const started=performance.now();const result=f.domain.analytics('2024-01-01','2027-01-01');
  const elapsed=performance.now()-started;
  assert.equal(result.series.length,1096);assert.equal(result.created,3000);assert.equal(result.completed,3000);
  assert.equal(result.ending_backlog,0);assert.equal(result.achievements.length,3000);
  assert.equal(result.series.reduce((sum,day)=>sum+day.created,0),3000);
  assert.equal(result.series.reduce((sum,day)=>sum+day.completed,0),3000);
  // Allows substantial CI variance; the old repeated Temporal conversion loop
  // performs over thirteen million conversions for this same valid request.
  assert.ok(elapsed<15000,`Analytics blocked for ${Math.round(elapsed)}ms`);
  assert.throws(()=>f.domain.analytics('2023-01-01','2027-01-01'),/tres años/);
 }finally{f.db.close();}
});
