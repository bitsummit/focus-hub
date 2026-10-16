import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';
test('quick capture priority is atomic, validated, idempotent and preserves shorthand defaults',()=>{
 const db=openDatabase(':memory:');try {
  const user=createOwner(db,{email:'capture-priority@example.test',password:'Fictional-Priority-2026!'});
  const ws=String(db.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(user.id)!.id);
  const domain=new Domain(db,{user_id:user.id,workspace_id:ws});
  const input={text:'Tarea ficticia baja',priority:'low' as const,request_id:randomUUID()};
  const first=domain.capture(input);assert.equal(first.priority,'low');assert.equal(first.project_id,null);assert.equal(domain.capture(input).id,first.id);
  assert.equal(domain.capture({text:'!! Prioridad por prefijo',request_id:randomUUID()}).priority,'critical');
  assert.throws(()=>domain.capture({text:'No debe crearse',request_id:randomUUID(),priority:'invalid' as any}));
  const state=domain.snapshot();assert.equal(state.tasks.length,2);assert.equal(state.events.filter(e=>e.task_id===first.id&&e.event_type==='created').length,1);
 }finally{db.close();}
});
