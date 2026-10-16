import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';

function fixture(){
 const db=openDatabase(':memory:');
 const user=createOwner(db,{email:'journal-edge@example.test',password:'Fictional-journal-test-password'});
 const workspace=db.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(user.id)!;
 return {db,domain:new Domain(db,{user_id:user.id,workspace_id:String(workspace.id)})};
}
test('Journal inferred nesting cannot attach to a deleted parent or jump to its older sibling',()=>{
 const {db,domain:d}=fixture();try{
  const date='2026-10-16';
  d.appendBlock(date,{text:'- [ ] Older sibling',request_id:randomUUID(),revision:0});
  d.appendBlock(date,{text:'- [ ] Removed parent',request_id:randomUUID(),revision:1});
  const parent=d.snapshot().tasks.find(t=>t.title==='Removed parent')!;d.deleteTask(parent.id);
  d.appendBlock(date,{text:'- [ ] New child',request_id:randomUUID(),revision:2,indent_level:1});
  const state=d.snapshot();assert.equal(state.tasks.find(t=>t.title==='New child')!.parent_task_id,null);
  assert.equal(state.tasks.length,3);assert.ok(state.tasks.find(t=>t.id===parent.id)!.deleted_at);
 }finally{db.close();}
});
test('Journal headings isolate parent-task context while preserving live nesting in the current section',()=>{
 const {db,domain:d}=fixture();try{
  const date='2026-10-16';
  d.appendBlock(date,{text:'# Primera sección',request_id:randomUUID(),revision:0});
  d.appendBlock(date,{text:'- [ ] Parent in first section',request_id:randomUUID(),revision:1});
  d.appendBlock(date,{text:'# Segunda sección',request_id:randomUUID(),revision:2});
  d.appendBlock(date,{text:'- [ ] First task in second section',request_id:randomUUID(),revision:3,indent_level:1});
  const first=d.snapshot().tasks.find(t=>t.title==='First task in second section')!;
  assert.equal(first.parent_task_id,null);
  d.appendBlock(date,{text:'- [ ] Real child',request_id:randomUUID(),revision:4,indent_level:2});
  assert.equal(d.snapshot().tasks.find(t=>t.title==='Real child')!.parent_task_id,first.id);
 }finally{db.close();}
});
