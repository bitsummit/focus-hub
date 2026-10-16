import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase} from './db.ts';
import {createOwner} from './auth.ts';
import {Domain} from './domain.ts';
import {localDate,periodStart,addDays} from './calendar.ts';
// Explicitly opt-in, separate fictional workspace. Never seed the real owner's DB.
const path=resolve('.data/demo.sqlite');
if(existsSync(path)){console.error('La demo ya existe. Se conserva sin sobrescribirla. Consulta .data/demo-access.json.');process.exit(1);}
mkdirSync(dirname(path),{recursive:true,mode:0o700});
const db=openDatabase(path),password=randomBytes(24).toString('base64url');
try{
 const user=createOwner(db,{email:'demo@example.test',password,display_name:'Espacio de demostración'});
 const workspace=db.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(user.id)!;
 const d=new Domain(db,{user_id:user.id,workspace_id:String(workspace.id)});
 const goal=d.createEntity('goals',{title:'Dar forma a una idea',description:'Objetivo ficticio · convertir una idea pequeña en un resultado tangible.',period_start:'2026-10-01',period_end:'2026-12-31'});
 const project=d.createEntity('projects',{name:'Estudio Aurora',slug:'aurora',description:'Proyecto ficticio · explorar una nueva identidad visual.',goal_id:goal.id,color:'#427c71'});
 const garden=d.createEntity('projects',{name:'Jardín de ideas',slug:'jardin',description:'Proyecto ficticio · lecturas y pequeños experimentos.',color:'#bc8b4b'});
 d.createEntity('milestones',{title:'Definir el punto de partida',goal_id:goal.id,project_id:project.id,status:'achieved'});
 d.createEntity('milestones',{title:'Preparar la primera propuesta',goal_id:goal.id,project_id:project.id});
 const a=d.capture({text:'!! Preparar propuesta visual #aurora',request_id:randomUUID()});
 const b=d.capture({text:'! Elegir tres referencias #aurora',request_id:randomUUID()});
 const c=d.capture({text:'Revisar la lista de lecturas #jardin',request_id:randomUUID()});
 const done=d.capture({text:'Ordenar las primeras ideas #aurora',request_id:randomUUID()});
 d.updateTask(a.id,{status:'in_progress',description:'Datos de demostración ficticios. Explorar una dirección tranquila y clara.'});
 d.updateTask(b.id,{status:'waiting_external',waiting_on:'Revisión del equipo ficticio',follow_up_at:addDays(localDate(user.timezone),2)});
 d.updateTask(done.id,{status:'completed'});
 const today=localDate(user.timezone);
 d.setFocus('daily',today,[a.id,c.id]);d.setFocus('weekly',periodStart(today,'weekly'),[a.id,b.id,c.id]);
 d.appendBlock(today,{text:'# Estudio Aurora',request_id:randomUUID(),revision:0});
 d.appendBlock(today,{text:'Este espacio contiene únicamente datos ficticios para probar Focus Hub.',request_id:randomUUID(),revision:1});
 d.appendBlock(today,{text:'',task_id:a.id,request_id:randomUUID(),revision:2});
 writeFileSync(resolve('.data/demo-access.json'),JSON.stringify({email:user.email,password,database:'.data/demo.sqlite',notice:'Credenciales locales generadas para datos ficticios. No subir a Git.'},null,2),{mode:0o600});
 console.log('Demo ficticia creada en .data/demo.sqlite. Acceso guardado localmente en .data/demo-access.json (modo 0600).');
 console.log('Arranca con: FOCUS_DB=.data/demo.sqlite npm start');
}finally{db.close();}
