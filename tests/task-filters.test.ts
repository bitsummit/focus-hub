import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterTask,matchesQuickFilter,type TaskFilters} from '../src/task-filters.ts';
import type {Task} from '../shared/contracts.ts';
const base:Task={id:'fictional-task',workspace_id:'fictional-workspace',created_by_user_id:'fictional-user',title:'Preparar propuesta Ámbar',description:'Revisión con equipo ficticio',project_id:null,parent_task_id:null,status:'pending',priority:'normal',due_at:null,waiting_on:'',follow_up_at:null,completed_at:null,cancelled_at:null,deleted_at:null,sort_order:0,tags:['diseño'],created_at:'2026-10-16T10:00:00.000Z',updated_at:'2026-10-16T10:00:00.000Z'};
const filters:TaskFilters={search:'',project:'',status:'',priority:''};
test('quick chips cover inbox, chosen daily focus, high priority and both external waiting states',()=>{
 const ids=new Set([base.id]);
 assert.equal(matchesQuickFilter(base,'all',ids),true);
 assert.equal(matchesQuickFilter(base,'inbox',ids),true);
 assert.equal(matchesQuickFilter({...base,project_id:'project'},'inbox',ids),false);
 assert.equal(matchesQuickFilter(base,'today',ids),true);
 assert.equal(matchesQuickFilter(base,'today',new Set()),false);
 for(const priority of ['high','critical'] as const)assert.equal(matchesQuickFilter({...base,priority},'priority',ids),true);
 for(const priority of ['low','normal'] as const)assert.equal(matchesQuickFilter({...base,priority},'priority',ids),false);
 for(const status of ['pending_review','waiting_external'] as const)assert.equal(matchesQuickFilter({...base,status},'waiting',ids),true);
 assert.equal(matchesQuickFilter({...base,status:'blocked'},'blocked',ids),true);
 assert.equal(matchesQuickFilter({...base,status:'in_progress'},'waiting',ids),false);
});
test('every quick chip excludes completed, cancelled and soft-deleted tasks',()=>{
 for(const chip of ['all','inbox','today','priority','waiting','blocked'] as const){
  for(const status of ['completed','cancelled'] as const)assert.equal(matchesQuickFilter({...base,status,priority:'critical'},chip,new Set([base.id])),false);
  assert.equal(matchesQuickFilter({...base,deleted_at:base.created_at},chip,new Set([base.id])),false);
 }
});
test('advanced filters intersect rather than override each other and combine with quick chips',()=>{
 const t={...base,project_id:'project',priority:'high' as const,status:'pending_review' as const};
 assert.equal(filterTask(t,{...filters,search:'PROPUESTA',project:'project',status:'pending_review',priority:'high'}),true);
 for(const mismatch of [{project:'other'},{status:'blocked'},{priority:'low'},{search:'missing title'}])assert.equal(filterTask(t,{...filters,...mismatch}),false);
 assert.equal(filterTask(t,{...filters,project:'project'})&&matchesQuickFilter(t,'inbox',new Set()),false);
 assert.equal(filterTask(t,{...filters,priority:'high'})&&matchesQuickFilter(t,'waiting',new Set()),true);
});
