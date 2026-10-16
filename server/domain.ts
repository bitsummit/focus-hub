import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Temporal } from '@js-temporal/polyfill';
import { transaction } from './db.ts';
import { addDays, localDate, periodBounds, periodStart } from './calendar.ts';
import { STATUSES, PRIORITIES, type AuthContext, type CaptureInput, type JournalAppend, type Snapshot, type Analytics, type Task, type User } from '../shared/contracts.ts';

type Row = Record<string, any>;
type EntityKind = 'projects'|'goals'|'milestones';
const tables = {projects:'projects',goals:'strategic_goals',milestones:'milestones'} as const;
export class DomainError extends Error {
 constructor(message:string, public status=400, public code='VALIDATION_ERROR'){super(message);}
}
function fail(message:string,status=400,code='VALIDATION_ERROR'):never {throw new DomainError(message,status,code);}
function object(value:unknown):Row { if(!value || typeof value!=='object' || Array.isArray(value)) fail('Se esperaba un objeto.'); return value as Row; }
function text(value:unknown,name:string,max=500,empty=false):string {
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||value.includes('\0')) fail(`${name}: texto inválido (máximo ${max}).`);
 return value.trim();
}
function enumValue(value:unknown,allowed:readonly string[],name:string):string {if(typeof value!=='string'||!allowed.includes(value)) fail(`${name}: valor inválido.`);return value;}
function integer(value:unknown,name:string,min=0,max=8):number {if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max) fail(`${name}: número inválido.`);return value;}
function date(value:unknown,name='Fecha'):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name}: usa AAAA-MM-DD.`);
 try { if(Temporal.PlainDate.from(value).toString()!==value) fail(`${name}: fecha inválida.`); }catch {fail(`${name}: fecha inválida.`);}return value;
}
function optionalDate(value:unknown,name:string):string|null {
 if(value===null||value==='') return null;
 if(typeof value!=='string') fail(`${name}: fecha inválida.`);
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value,name);
 try {return Temporal.Instant.from(value).toString({smallestUnit:'millisecond'});} catch {fail(`${name}: fecha inválida.`);}
}
function allowed(input:Row,keys:string[]):void {for(const key of Object.keys(input)) if(!keys.includes(key)) fail(`Campo no permitido: ${key}.`);}
const now=()=>new Date().toISOString();
const isOpen=(status:string)=>status!=='completed'&&status!=='cancelled';

/** Every query is bound to the authenticated workspace; provider details stay outside domain services. */
export class Domain {
 constructor(private db:DatabaseSync, private context:AuthContext) {
  if(!this.one('SELECT 1 AS ok FROM workspace_members WHERE workspace_id=? AND user_id=?',context.workspace_id,context.user_id)) fail('Espacio no disponible.',403,'FORBIDDEN');
 }
 private all(sql:string,...params:SQLInputValue[]):Row[] {return this.db.prepare(sql).all(...params) as Row[];}
 private one(sql:string,...params:SQLInputValue[]):Row|undefined {return this.db.prepare(sql).get(...params) as Row|undefined;}
 private run(sql:string,...params:SQLInputValue[]) {return this.db.prepare(sql).run(...params);}
 private get ws(){return this.context.workspace_id;}
 private get uid(){return this.context.user_id;}
 private user():User {return this.one('SELECT id,email,display_name,timezone,theme,preferred_task_view,week_start_day,created_at FROM users WHERE id=?',this.uid) as User;}
 private scoped(table:string,id:unknown,extra=''):Row {
  const key=text(id,'Identificador',200);
  const row=this.one(`SELECT * FROM ${table} WHERE id=? AND workspace_id=? ${extra}`,key,this.ws);
  if(!row) fail('Registro no encontrado.',404,'NOT_FOUND');return row;
 }
 private task(id:unknown,includeDeleted=false):Task {
  const row=this.scoped('tasks',id,includeDeleted?'':'AND deleted_at IS NULL');
  return {...row,tags:JSON.parse(row.tags)} as Task;
 }
 private reference(table:string,id:unknown):string|null {
  if(id===null||id==='') return null;
  const row=table==='tasks'?this.task(id):this.scoped(table,id);return row.id;
 }
 private insert(table:string,input:Row):void {
  const fields=Object.keys(input);
  this.run(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`,...fields.map(k=>input[k] as SQLInputValue));
 }
 private update(table:string,id:string,changes:Row):void {
  const fields=Object.keys(changes);if(!fields.length) return;
  this.run(`UPDATE ${table} SET ${fields.map(k=>`${k}=?`).join(',')} WHERE id=? AND workspace_id=?`,...fields.map(k=>changes[k] as SQLInputValue),id,this.ws);
 }
 private event(taskId:string,type:string,from:unknown,to:unknown,time=now()):void {
  this.insert('task_events',{id:randomUUID(),workspace_id:this.ws,task_id:taskId,actor_user_id:this.uid,event_type:type,from_value_json:from===undefined?null:JSON.stringify(from),to_value_json:to===undefined?null:JSON.stringify(to),occurred_at:time});
 }
 private idempotent<T>(kind:string,key:unknown,payload:unknown,action:()=>T):T {
  const request=text(key,'Identificador de solicitud',160);
  const fingerprint=JSON.stringify({kind,user_id:this.uid,payload});
  const previous=this.one('SELECT result_json FROM idempotency_keys WHERE workspace_id=? AND request_id=?',this.ws,request);
  if(previous){const cached=JSON.parse(previous.result_json);if(cached.fingerprint!==fingerprint) fail('La solicitud ya se utilizó con otro contenido.',409,'IDEMPOTENCY_CONFLICT');return cached.result as T;}
  const result=action();this.insert('idempotency_keys',{workspace_id:this.ws,request_id:request,result_json:JSON.stringify({fingerprint,result}),created_at:now()});return result;
 }
 snapshot():Snapshot {
  const taskRows=this.all('SELECT * FROM tasks WHERE workspace_id=? ORDER BY sort_order,created_at,id',this.ws).map(t=>({...t,tags:JSON.parse(t.tags)}));
  return {user:this.user(),workspace:this.one('SELECT * FROM workspaces WHERE id=?',this.ws),tasks:taskRows,projects:this.all('SELECT * FROM projects WHERE workspace_id=? ORDER BY sort_order,created_at',this.ws),goals:this.all('SELECT * FROM strategic_goals WHERE workspace_id=? ORDER BY sort_order,created_at',this.ws),milestones:this.all('SELECT * FROM milestones WHERE workspace_id=? ORDER BY sort_order,created_at',this.ws),events:this.all('SELECT * FROM task_events WHERE workspace_id=? ORDER BY occurred_at,rowid',this.ws),journals:this.all('SELECT * FROM journal_entries WHERE workspace_id=? AND author_user_id=? ORDER BY entry_date',this.ws,this.uid),blocks:this.all('SELECT b.* FROM journal_blocks b JOIN journal_entries j ON j.id=b.journal_entry_id AND j.workspace_id=b.workspace_id WHERE b.workspace_id=? AND j.author_user_id=? ORDER BY b.sort_order,b.created_at,b.rowid',this.ws,this.uid),focus:this.all('SELECT * FROM focus_items WHERE workspace_id=? AND user_id=? ORDER BY period_start,sort_order',this.ws,this.uid)} as Snapshot;
 }
 private parsedCapture(raw:string,projectId:string|null):{title:string;priority:string;project_id:string|null} {
  let title=text(raw,'Tarea',2000).replace(/^\s*-\s*\[\s*\]\s*/, '');
  let priority='normal';if(title.startsWith('!!')){priority='critical';title=title.slice(2).trim();}else if(title.startsWith('!')){priority='high';title=title.slice(1).trim();}
  const matches=[...title.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)];
  for(const match of matches){const project=this.one('SELECT id FROM projects WHERE workspace_id=? AND (slug=? COLLATE NOCASE OR name=? COLLATE NOCASE)',this.ws,match[1],match[1]);if(project){projectId=project.id;title=title.replace(match[0],' ').trim();}}
  return {title:text(title,'Título',500),priority,project_id:projectId};
 }
 private createTask(input:CaptureInput,projectContext:string|null=null,parentContext:string|null=null):Task {
  const parsed=this.parsedCapture(input.text,input.project_id===undefined?projectContext:this.reference('projects',input.project_id));
  const parent=this.reference('tasks',input.parent_task_id===undefined?parentContext:input.parent_task_id);
  const time=now(),id=randomUUID();
  this.insert('tasks',{id,workspace_id:this.ws,...parsed,parent_task_id:parent,created_by_user_id:this.uid,created_at:time,updated_at:time});
  const task=this.task(id);this.event(id,'created',undefined,task,time);return task;
 }
 capture(input:CaptureInput):Task {
  const value=object(input);allowed(value,['text','request_id','project_id','parent_task_id','journal_date','indent_level']);text(value.text,'Tarea',2000);
  return transaction(this.db,()=>this.idempotent('capture',value.request_id,value,()=>{
   const task=this.createTask(input);
   if(input.journal_date){const entry=this.entry(date(input.journal_date));this.newBlock(entry,'task_reference','',task.id,input.indent_level===undefined?0:integer(input.indent_level,'Sangría'));this.bump(entry);}
   return task;
  }));
 }
 updateTask(id:string,input:unknown):Task {
  const value=object(input);allowed(value,['title','description','status','priority','project_id','parent_task_id','due_at','waiting_on','follow_up_at','tags','sort_order']);
  return transaction(this.db,()=>{
   const original=this.task(id);const changes:Row={};
   for(const key of ['title','description','waiting_on']) if(key in value) changes[key]=text(value[key],key,key==='description'?20000:500,key!=='title');
   if('status'in value) changes.status=enumValue(value.status,STATUSES,'Estado');
   if('priority'in value) changes.priority=enumValue(value.priority,PRIORITIES,'Prioridad');
   if('project_id'in value) changes.project_id=this.reference('projects',value.project_id);
   if('parent_task_id'in value){changes.parent_task_id=this.reference('tasks',value.parent_task_id);let cursor=changes.parent_task_id;const visited=new Set<string>([id]);while(cursor){if(visited.has(cursor)) fail('La subtarea no puede formar un ciclo.');visited.add(cursor);cursor=this.task(cursor).parent_task_id;}}
   for(const key of ['due_at','follow_up_at']) if(key in value) changes[key]=optionalDate(value[key],key);
   if('sort_order'in value){if(typeof value.sort_order!=='number'||!Number.isFinite(value.sort_order)||Math.abs(value.sort_order)>1e12) fail('Orden inválido.');changes.sort_order=value.sort_order;}
   if('tags'in value){if(!Array.isArray(value.tags)||value.tags.length>30) fail('Etiquetas inválidas.');changes.tags=JSON.stringify([...new Set(value.tags.map((v:unknown)=>text(v,'Etiqueta',60)))]);}
   const time=now();
   for(const key of ['title','priority','project_id','parent_task_id','description','waiting_on','due_at','follow_up_at','tags']) if(key in changes){const before=key==='tags'?JSON.stringify(original.tags):(original as unknown as Row)[key];if(before!==changes[key])this.event(id,`${key.replace('_id','')}_changed`,key==='tags'?original.tags:before,key==='tags'?JSON.parse(changes[key]):changes[key],time);}
   if(changes.status!==undefined&&changes.status!==original.status){
    this.event(id,'status_changed',original.status,changes.status,time);
    if(original.status==='completed')this.event(id,'reopened',original.status,changes.status,time);
    if(changes.status==='completed'){changes.completed_at=time;this.event(id,'completed',original.status,{status:'completed',priority:changes.priority??original.priority,project_id:changes.project_id===undefined?original.project_id:changes.project_id},time);}else changes.completed_at=null;
    if(changes.status==='cancelled'){changes.cancelled_at=time;this.event(id,'cancelled',original.status,'cancelled',time);}else changes.cancelled_at=null;
   }
   this.update('tasks',id,{...changes,updated_at:time});return this.task(id);
  });
 }
 deleteTask(id:string):void {
  transaction(this.db,()=>{const task=this.task(id);const time=now();this.update('tasks',id,{deleted_at:time,updated_at:time});this.event(id,'deleted',task.status,{deleted_at:time},time);});
 }
 private entityData(kind:EntityKind,input:unknown,creating:boolean):Row {
  const value=object(input);const keys=kind==='projects'?['name','slug','description','goal_id','color','icon','status','target_date','sort_order']:kind==='goals'?['title','description','period_start','period_end','status','sort_order']:['title','description','project_id','goal_id','status','sort_order'];allowed(value,keys);
  const changes:Row={};const titleKey=kind==='projects'?'name':'title';
  if(creating||titleKey in value) changes[titleKey]=text(value[titleKey],titleKey,250);
  if('description'in value)changes.description=text(value.description,'Descripción',20000,true);
  if('goal_id'in value) changes.goal_id=this.reference('strategic_goals',value.goal_id);
  if('project_id'in value) changes.project_id=this.reference('projects',value.project_id);
  if('status'in value)changes.status=enumValue(value.status,kind==='projects'?['active','on_hold','archived']:kind==='goals'?['active','achieved','paused','archived']:['pending','achieved'],'Estado');
  if('sort_order'in value){if(typeof value.sort_order!=='number'||!Number.isFinite(value.sort_order)||Math.abs(value.sort_order)>1e12)fail('Orden inválido.');changes.sort_order=value.sort_order;}
  for(const key of ['target_date','period_start','period_end'])if(key in value)changes[key]=value[key]===null||value[key]===''?null:date(value[key]);
  if(kind==='projects'){
   if('color'in value){if(typeof value.color!=='string'||!/^#[0-9a-f]{6}$/i.test(value.color))fail('Color inválido.');changes.color=value.color;}
   if('icon'in value)changes.icon=text(value.icon,'Icono',50);
   if('slug'in value||creating){const slug='slug'in value?text(value.slug,'Código del proyecto',80):changes.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||`project-${randomUUID().slice(0,6)}`;if(!/^[\p{L}\p{N}_-]+$/u.test(slug))fail('Código de proyecto inválido.');changes.slug=slug;}
  }
  return changes;
 }
 createEntity(kind:EntityKind,input:unknown):Row {
  if(!(kind in tables))fail('Recurso inválido.');
  return transaction(this.db,()=>{const changes=this.entityData(kind,input,true);if(kind==='projects'&&this.one('SELECT id FROM projects WHERE workspace_id=? AND slug=? COLLATE NOCASE',this.ws,changes.slug))fail('Ya existe ese código de proyecto.',409,'CONFLICT');if(kind==='milestones'&&!changes.project_id&&!changes.goal_id)fail('Asocia el hito a un objetivo o proyecto.');if(kind==='goals'&&changes.period_start&&changes.period_end&&changes.period_start>changes.period_end)fail('Periodo inválido.');const time=now(),id=randomUUID();if(kind==='milestones')changes.achieved_at=changes.status==='achieved'?time:null;this.insert(tables[kind],{id,workspace_id:this.ws,...changes,created_at:time,updated_at:time});return this.scoped(tables[kind],id);});
 }
 updateEntity(kind:EntityKind,id:string,input:unknown):Row {
  if(!(kind in tables))fail('Recurso inválido.');
  return transaction(this.db,()=>{const original=this.scoped(tables[kind],id);const changes=this.entityData(kind,input,false);const merged={...original,...changes};if(kind==='projects'&&changes.slug&&this.one('SELECT id FROM projects WHERE workspace_id=? AND slug=? COLLATE NOCASE AND id<>?',this.ws,changes.slug,id))fail('Ya existe ese código de proyecto.',409,'CONFLICT');if(kind==='milestones'&&!merged.project_id&&!merged.goal_id)fail('Asocia el hito a un objetivo o proyecto.');if(kind==='goals'&&merged.period_start&&merged.period_end&&merged.period_start>merged.period_end)fail('Periodo inválido.');const time=now();if(kind==='milestones'&&changes.status!==undefined&&changes.status!==original.status)changes.achieved_at=changes.status==='achieved'?time:null;this.update(tables[kind],id,{...changes,updated_at:time});return this.scoped(tables[kind],id);});
 }
 private entry(entryDate:string):Row {
  let entry=this.one('SELECT * FROM journal_entries WHERE workspace_id=? AND author_user_id=? AND entry_date=?',this.ws,this.uid,entryDate);
  if(!entry){const time=now();const id=randomUUID();this.insert('journal_entries',{id,workspace_id:this.ws,author_user_id:this.uid,entry_date:entryDate,created_at:time,updated_at:time});entry=this.scoped('journal_entries',id);}return entry;
 }
 private bump(entry:Row):void {this.update('journal_entries',entry.id,{revision:entry.revision+1,updated_at:now()});}
 private revision(entry:Row,value:unknown):void {if(entry.revision!==integer(value,'Versión',0,1e9))fail('El diario ha cambiado. Actualízalo antes de guardar.',409,'REVISION_CONFLICT');}
 private newBlock(entry:Row,type:string,content:string,taskId:string|null,indent:number):Row {
  const time=now(),id=randomUUID();const order=(this.one('SELECT MAX(sort_order) AS value FROM journal_blocks WHERE workspace_id=? AND journal_entry_id=?',this.ws,entry.id)?.value??-1)+1;
  this.insert('journal_blocks',{id,workspace_id:this.ws,journal_entry_id:entry.id,block_type:type,text_content:content,task_id:taskId,indent_level:indent,sort_order:order,created_at:time,updated_at:time});return this.scoped('journal_blocks',id);
 }
 appendBlock(entryDate:string,input:JournalAppend):Row {
  date(entryDate);const value=object(input);allowed(value,['text','request_id','revision','indent_level','task_id']);text(value.text,'Texto del diario',20000,true);
  return transaction(this.db,()=>this.idempotent('journal',value.request_id,{date:entryDate,...value},()=>{
   const entry=this.entry(entryDate);this.revision(entry,value.revision);let indent=value.indent_level===undefined?Math.min(8,Math.floor((value.text.match(/^ */)?.[0].length??0)/2)):integer(value.indent_level,'Sangría');
   const raw=value.text.trim();let type='paragraph',content=raw,taskId:string|null=null;
   if(value.task_id){taskId=this.task(value.task_id).id;type='task_reference';content='';}
   else if(/^-\s*\[\s*\]\s*/.test(raw)){
    const blocks=this.all('SELECT * FROM journal_blocks WHERE workspace_id=? AND journal_entry_id=? ORDER BY sort_order DESC,rowid DESC',this.ws,entry.id);
    const heading=blocks.find(b=>b.block_type==='heading');const headingText=heading?.text_content?.replace(/^#+\s*/,'').trim();
    const project=headingText?this.one('SELECT id FROM projects WHERE workspace_id=? AND (slug=? COLLATE NOCASE OR name=? COLLATE NOCASE)',this.ws,headingText,headingText):undefined;
    // A heading ends the nesting context. A removed parent cannot silently
    // redirect its next child to an older, unrelated sibling.
    let parentId:string|null=null;
    if(indent>0)for(const block of blocks){
     if(block.block_type==='heading')break;
     if(block.block_type==='task_reference'&&block.indent_level<indent){
      const candidate=this.one('SELECT id FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL',block.task_id,this.ws);
      parentId=candidate?.id??null;break;
     }
    }
    const task=this.createTask({text:raw,request_id:value.request_id},project?.id??null,parentId);taskId=task.id;type='task_reference';content='';
   }else if(/^#{1,6}\s+/.test(raw)){type='heading';content=raw.replace(/^#{1,6}\s+/,'');indent=0;}
   else if(/^[-*]\s+/.test(raw)){type='bullet';content=raw.replace(/^[-*]\s+/,'');}
   const block=this.newBlock(entry,type,content,taskId,indent);this.bump(entry);return block;
  }));
 }
 private ownBlock(id:string):{block:Row;entry:Row} {
  const block=this.scoped('journal_blocks',id);const entry=this.scoped('journal_entries',block.journal_entry_id);if(entry.author_user_id!==this.uid)fail('Registro no encontrado.',404,'NOT_FOUND');return {block,entry};
 }
 updateBlock(id:string,input:unknown):Row {
  const value=object(input);allowed(value,['revision','text_content','indent_level','sort_order']);
  return transaction(this.db,()=>{const {block,entry}=this.ownBlock(id);this.revision(entry,value.revision);const changes:Row={};if('text_content'in value){if(block.block_type==='task_reference')fail('Edita la tarea vinculada desde su registro.');changes.text_content=text(value.text_content,'Texto',20000,true);}if('indent_level'in value)changes.indent_level=integer(value.indent_level,'Sangría');if('sort_order'in value){if(typeof value.sort_order!=='number'||!Number.isFinite(value.sort_order))fail('Orden inválido.');changes.sort_order=value.sort_order;}this.update('journal_blocks',id,{...changes,updated_at:now()});this.bump(entry);return this.scoped('journal_blocks',id);});
 }
 deleteBlock(id:string,revision:number):void {
  transaction(this.db,()=>{const {entry}=this.ownBlock(id);this.revision(entry,revision);this.run('DELETE FROM journal_blocks WHERE id=? AND workspace_id=?',id,this.ws);this.bump(entry);});
 }
 setFocus(type:string,entryDate:string,taskIds:unknown):void {
  enumValue(type,['daily','weekly'],'Periodo');date(entryDate);
  if(periodStart(entryDate,type as 'daily'|'weekly',this.user().week_start_day)!==entryDate)fail('La semana debe comenzar en el día configurado.');
  if(!Array.isArray(taskIds)||taskIds.length>(type==='daily'?3:5)||new Set(taskIds).size!==taskIds.length)fail('Elige hasta 3 tareas diarias o 5 semanales, sin duplicados.');
  transaction(this.db,()=>{const tasks=taskIds.map(id=>this.task(id));const existing=new Set(this.all('SELECT task_id FROM focus_items WHERE workspace_id=? AND user_id=? AND period_type=? AND period_start=?',this.ws,this.uid,type,entryDate).map(item=>item.task_id));for(const task of tasks)if(!isOpen(task.status)&&!existing.has(task.id))fail('Selecciona tareas abiertas para el foco.');this.run('DELETE FROM focus_items WHERE workspace_id=? AND user_id=? AND period_type=? AND period_start=?',this.ws,this.uid,type,entryDate);for(const [index,task]of tasks.entries())this.insert('focus_items',{id:randomUUID(),workspace_id:this.ws,user_id:this.uid,task_id:task.id,period_type:type,period_start:entryDate,sort_order:index,created_at:now()});});
 }
 preferences(input:unknown):User {
  const value=object(input);allowed(value,['display_name','timezone','theme','preferred_task_view','week_start_day']);const changes:Row={};
  if('display_name'in value)changes.display_name=text(value.display_name,'Nombre',150);
  if('timezone'in value){const zone=text(value.timezone,'Zona horaria',100);if(/^[+-]/.test(zone))fail('Selecciona una zona horaria IANA.');try{Temporal.Now.zonedDateTimeISO(zone);}catch{fail('Zona horaria IANA inválida.');}changes.timezone=zone;}
  if('theme'in value)changes.theme=enumValue(value.theme,['light','dark','system'],'Tema');
  if('preferred_task_view'in value)changes.preferred_task_view=enumValue(value.preferred_task_view,['board','table'],'Vista');
  if('week_start_day'in value)changes.week_start_day=integer(value.week_start_day,'Inicio de semana',0,1);
  const keys=Object.keys(changes);if(keys.length)this.run(`UPDATE users SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`,...keys.map(k=>changes[k]),this.uid);return this.user();
 }
 analytics(start:string,end:string):Analytics {
  date(start);date(end);if(start>=end)fail('El fin del periodo debe ser posterior al inicio.');let dateCursor=start;let days=0;while(dateCursor<end){if(++days>1098)fail('Selecciona un periodo de hasta tres años.');dateCursor=addDays(dateCursor,1);}
  const zone=this.user().timezone;const bounds=periodBounds(start,end,zone);const events=this.all('SELECT * FROM task_events WHERE workspace_id=? AND occurred_at<? ORDER BY occurred_at,rowid',this.ws,bounds.end);
  const period=events.filter(e=>e.occurred_at>=bounds.start);const distinct=(type:string)=>new Set(period.filter(e=>e.event_type===type).map(e=>e.task_id)).size;
  const seenCompletions=new Set<string>();const achievements:Row[]=[];for(const event of period)if(event.event_type==='completed'&&!seenCompletions.has(event.task_id)){seenCompletions.add(event.task_id);achievements.push(event);}
  const state=new Map<string,{status:string;deleted:boolean}>();for(const event of events){let current=state.get(event.task_id);if(event.event_type==='created'){let created:Row={};try{created=JSON.parse(event.to_value_json??'{}');}catch{}current={status:created.status??'pending',deleted:false};state.set(event.task_id,current);}else if(current){if(event.event_type==='status_changed'){try{const next=JSON.parse(event.to_value_json);current.status=typeof next==='string'?next:next.status;}catch{}}if(event.event_type==='deleted')current.deleted=true;if(event.event_type==='restored')current.deleted=false;}}
  const distribution:Record<string,number>=Object.fromEntries(STATUSES.map(s=>[s,0]));let ending=0;for(const item of state.values())if(!item.deleted){distribution[item.status]=(distribution[item.status]??0)+1;if(isOpen(item.status))ending++;}
  const series:Analytics['series']=[];for(let day=start;day<end;day=addDays(day,1)){const dayEvents=period.filter(e=>localDate(zone,e.occurred_at)===day);series.push({date:day,created:new Set(dayEvents.filter(e=>e.event_type==='created').map(e=>e.task_id)).size,completed:new Set(dayEvents.filter(e=>e.event_type==='completed').map(e=>e.task_id)).size});}
  const created=distinct('created'),completed=distinct('completed');
  return {created,completed,reopened:distinct('reopened'),cancelled:distinct('cancelled'),net:completed-created,ending_backlog:ending,series,achievements:achievements as Analytics['achievements'],milestones:this.all('SELECT * FROM milestones WHERE workspace_id=? AND achieved_at>=? AND achieved_at<? ORDER BY achieved_at',this.ws,bounds.start,bounds.end) as Analytics['milestones'],distribution};
 }
 exportJSON():Row {
  const snapshot=this.snapshot();return {schemaVersion:1,exportedAt:now(),metricDefinitions:{completed:'Distinct task IDs with verified completion events inside the selected local period; re-completion can count in different periods.',net:'completed - created',ending_backlog:'Open, non-deleted tasks reconstructed at the exclusive period end.'},...snapshot};
 }
 exportCSV():string {
  const fields=['id','workspace_id','title','description','project_id','parent_task_id','status','priority','tags','due_at','waiting_on','follow_up_at','completed_at','cancelled_at','deleted_at','created_by_user_id','created_at','updated_at','sort_order'];
  const escape=(value:unknown)=>{let raw=value==null?'':Array.isArray(value)?JSON.stringify(value):String(value);if(/^[\s\u0000-\u0020]*[=+@-]/.test(raw))raw=`'${raw}`;return `"${raw.replaceAll('"','""')}"`;};
  return '\uFEFF'+[fields.join(','),...this.snapshot().tasks.map(task=>fields.map(field=>escape((task as unknown as Row)[field])).join(','))].join('\r\n')+'\r\n';
 }
}
