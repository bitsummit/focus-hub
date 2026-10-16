import type {Task} from '../shared/contracts';
export type QuickFilter='all'|'inbox'|'today'|'priority'|'waiting'|'blocked';
export interface TaskFilters {search:string;project:string;status:string;priority:string}
export function filterTask(task:Task,filters:TaskFilters):boolean {
 const needle=filters.search.trim().toLocaleLowerCase('es');
 return !task.deleted_at && (!needle||[task.title,task.description,...task.tags].join(' ').toLocaleLowerCase('es').includes(needle))
  && (!filters.project||(filters.project==='inbox'?task.project_id===null:task.project_id===filters.project))
  && (!filters.status||task.status===filters.status) && (!filters.priority||task.priority===filters.priority);
}
export function matchesQuickFilter(task:Task,chip:QuickFilter,todayIds:Set<string>):boolean {
 if(task.deleted_at||task.status==='completed'||task.status==='cancelled')return false;
 switch(chip){
  case 'inbox':return task.project_id===null;
  case 'today':return todayIds.has(task.id);
  case 'priority':return task.priority==='high'||task.priority==='critical';
  case 'waiting':return task.status==='pending_review'||task.status==='waiting_external';
  case 'blocked':return task.status==='blocked';
  default:return true;
 }
}
