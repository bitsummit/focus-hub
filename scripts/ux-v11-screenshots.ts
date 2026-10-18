/** Reproducible fictional screenshots. Temporary PostgreSQL schema, isolated loopback port; never opens .data. */
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createTestDatabase} from '../tests/postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
import {Domain} from '../server/domain.ts';
import {localDate,periodStart} from '../server/calendar.ts';
const fixture=await createTestDatabase(),db=fixture.db;
const email='screenshots@example.test',password=randomBytes(30).toString('base64url');
const user=await createOwner(db,{email,password,display_name:'Cuenta ficticia'});
const workspace=await db.one('SELECT id FROM workspaces WHERE owner_user_id=$1',[user.id]) as {id:string};
const domain=new Domain(db,{user_id:user.id,workspace_id:workspace.id});
const goal=await domain.createEntity('goals',{title:'Preparar una nueva colección',description:'Objetivo ficticio de demostración'});
const project=await domain.createEntity('projects',{name:'Estudio Aurora',description:'Proyecto ficticio de diseño y comunicación',goal_id:goal.id,color:'#567d74'});
const second=await domain.createEntity('projects',{name:'Jardín de ideas',description:'Lecturas y pequeños experimentos ficticios',color:'#ac8850'});
await domain.createEntity('milestones',{title:'Preparar la propuesta inicial',project_id:project.id,goal_id:goal.id});
const titles=['Preparar propuesta visual','Elegir tres referencias para el equipo','Revisar la lista de lecturas','Recibir comentarios del prototipo','Resolver acceso al entorno de pruebas','Organizar las notas de la semana','Anotar una idea sin proyecto'];
const statuses=['in_progress','pending','pending','pending_review','blocked','waiting_external','pending'] as const;
const tasks=[];
for(const [i,text] of titles.entries()){const task=await domain.capture({text,request_id:randomUUID(),project_id:i===6?null:i===2?String(second.id):String(project.id),priority:i===0?'critical':i===1?'high':'normal'});await domain.updateTask(task.id,{status:statuses[i]});tasks.push(task);}
const completed=await domain.capture({text:'Compartir el primer boceto ficticio',request_id:randomUUID(),project_id:String(project.id)});await domain.updateTask(completed.id,{status:'completed'});
const today=localDate(user.timezone);await domain.setFocus('weekly',periodStart(today,'weekly',user.week_start_day),tasks.slice(0,3).map(t=>t.id));await domain.setFocus('daily',today,tasks.slice(0,2).map(t=>t.id));
const server=createApp(db).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No loopback fixture');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const output=resolve(process.argv[2]||'test-results/ux-v11');mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050},baseURL:`http://127.0.0.1:${address.port}`});await page.goto('/');await page.getByLabel(/correo/i).fill(email);await page.getByLabel(/contraseña/i).fill(password);await page.getByRole('button',{name:/entrar|iniciar sesión/i}).click();await page.getByRole('heading',{name:'Tareas',exact:true}).waitFor();
 for(const [mode,width,height] of [['desktop',1440,1050],['mobile',390,844]] as const){await page.setViewportSize({width,height});
  for(const [name,path] of [['dashboard','/dashboard'],['tasks-list','/'],['progress','/progress']] as const){await page.goto(path);await page.locator('h1').waitFor();if(path==='/progress')await page.locator('.metrics-grid').waitFor();await page.screenshot({path:join(output,`${name}-${mode}.png`),fullPage:true});}
  await page.goto('/');await page.getByRole('button',{name:'Kanban',exact:true}).click();await page.screenshot({path:join(output,`tasks-kanban-${mode}.png`),fullPage:true});
  await page.goto('/');await page.getByRole('button',{name:titles[0],exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:join(output,`task-editor-${mode}.png`)});await page.keyboard.press('Escape');
  if(mode==='mobile'){await page.getByRole('button',{name:'Capturar una tarea',exact:true}).click();await page.getByRole('dialog',{name:'Captura rápida',exact:true}).waitFor();await page.getByLabel('Título de la tarea',{exact:true}).fill('Una nueva idea para mañana');await page.screenshot({path:join(output,'quick-capture-mobile.png')});await page.keyboard.press('Escape');}
 }
 await page.setViewportSize({width:360,height:800});await page.goto('/');await page.screenshot({path:join(output,'tasks-list-mobile-360.png'),fullPage:true});
 await page.setViewportSize({width:768,height:1024});await page.goto('/');await page.screenshot({path:join(output,'tasks-list-tablet.png'),fullPage:true});
 await domain.preferences({theme:'dark'});await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:titles[0],exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:join(output,'task-editor-mobile-dark.png')});
 console.log(`Fictional v1.1 screenshots saved to ${output}`);
}finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await fixture.close();}
