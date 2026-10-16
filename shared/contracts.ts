export const STATUSES = ['pending','in_progress','pending_review','waiting_external','blocked','completed','cancelled'] as const;
export const PRIORITIES = ['low','normal','high','critical'] as const;
export type Status = typeof STATUSES[number];
export type Priority = typeof PRIORITIES[number];
export const statusLabels: Record<Status,string> = {pending:'Pendiente',in_progress:'En curso',pending_review:'Pendiente de revisión',waiting_external:'En espera de terceros',blocked:'Bloqueada',completed:'Completada',cancelled:'Cancelada'};
export const priorityLabels: Record<Priority,string> = {low:'Baja',normal:'Normal',high:'Alta',critical:'Crítica'};
export interface User {id:string; email:string; display_name:string; timezone:string; theme:'light'|'dark'|'system'; preferred_task_view:'board'|'table'; week_start_day:number; created_at:string}
export interface Workspace {id:string; name:string; owner_user_id:string; created_at:string}
export interface Base {id:string; workspace_id:string; created_at:string; updated_at:string}
export interface Task extends Base {title:string; description:string; project_id:string|null; parent_task_id:string|null; status:Status; priority:Priority; due_at:string|null; waiting_on:string; follow_up_at:string|null; completed_at:string|null; cancelled_at:string|null; deleted_at:string|null; created_by_user_id:string; sort_order:number; tags:string[]}
export interface Project extends Base {name:string; slug:string; description:string; goal_id:string|null; color:string; icon:string; status:'active'|'on_hold'|'archived'; target_date:string|null; sort_order:number}
export interface Goal extends Base {title:string; description:string; period_start:string|null; period_end:string|null; status:'active'|'achieved'|'paused'|'archived'; sort_order:number}
export interface Milestone extends Base {title:string; description:string; project_id:string|null; goal_id:string|null; status:'pending'|'achieved'; achieved_at:string|null; sort_order:number}
export interface TaskEvent {id:string; workspace_id:string; task_id:string; actor_user_id:string; event_type:string; from_value_json:string|null; to_value_json:string|null; occurred_at:string}
export interface JournalEntry extends Base {author_user_id:string; entry_date:string; title:string; revision:number}
export interface JournalBlock extends Base {journal_entry_id:string; block_type:'heading'|'paragraph'|'bullet'|'task_reference'; text_content:string; task_id:string|null; indent_level:number; sort_order:number}
export interface FocusItem {id:string; workspace_id:string; user_id:string; task_id:string; period_type:'daily'|'weekly'; period_start:string; sort_order:number; created_at:string}
export interface Snapshot {user:User; workspace:Workspace; tasks:Task[]; projects:Project[]; goals:Goal[]; milestones:Milestone[]; events:TaskEvent[]; journals:JournalEntry[]; blocks:JournalBlock[]; focus:FocusItem[]}
export interface Session {user:User; csrfToken:string}
export interface CaptureInput {text:string; request_id:string; priority?:Priority; project_id?:string|null; parent_task_id?:string|null; journal_date?:string; indent_level?:number}
export interface JournalAppend {text:string; request_id:string; revision:number; indent_level?:number; task_id?:string}
export interface Analytics {created:number; completed:number; reopened:number; cancelled:number; net:number; ending_backlog:number; series:{date:string;created:number;completed:number}[]; achievements:TaskEvent[]; milestones:Milestone[]; distribution:Record<string,number>}
export interface AuthContext {user_id:string; workspace_id:string}
