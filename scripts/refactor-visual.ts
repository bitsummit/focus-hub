/** Behavior-preserving refactor comparison. Uses only disposable fictional PostgreSQL.
 * Build first; run `npx tsx scripts/refactor-visual.ts baseline|compare [output] [variant] [states-comma-separated]`.
 * Output defaults to ignored test-results/refactor-visual. Run Playwright with a
 * separate --output directory afterwards, because its default clears test-results.
 * PNG equality uses Chromium's own bytes; computed styles/geometry provide a
 * second, inspectable signal. Artifacts are evidence, never commit them.
 */
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {chromium,type Page} from '@playwright/test';
import {createTestDatabase} from '../tests/postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';
import {createApp} from '../server/app.ts';
import {Domain} from '../server/domain.ts';

const phase=process.argv[2],output=resolve(process.argv[3]||'test-results/refactor-visual');
if(phase!=='baseline'&&phase!=='compare')throw Error('Usage: tsx scripts/refactor-visual.ts baseline|compare [output] [variant] [states-comma-separated]');
const directory=join(output,phase);mkdirSync(directory,{recursive:true});
const fixture=await createTestDatabase(),db=fixture.db;
const email='refactor-visual@example.test',password=randomBytes(30).toString('base64url');
const user=await createOwner(db,{email,password,display_name:'Cuenta ficticia QA'});
const workspace=await db.one('SELECT id FROM workspaces WHERE owner_user_id=$1',[user.id])as{id:string};
const domain=new Domain(db,{user_id:user.id,workspace_id:workspace.id});
const fixed='2026-10-15T12:00:00.000Z',today='2026-10-15';
const goal=await domain.createEntity('goals',{title:'Preparar una colección ficticia',description:'Objetivo de pruebas visuales'});
const project=await domain.createEntity('projects',{name:'Estudio Aurora',description:'Diseño ficticio para pruebas de interfaz',goal_id:goal.id,color:'#39796a'});
await domain.createEntity('projects',{name:'Jardín de ideas',description:'Lecturas y experimentos ficticios',color:'#ac8850'});
await domain.createEntity('milestones',{title:'Presentar la propuesta inicial',project_id:project.id,goal_id:goal.id});
const title='Preparar propuesta visual';
const titles=[title,'Elegir referencias y documentar una decisión con un título deliberadamente largo','Anotar una idea sin proyecto','Revisar comentarios del equipo','Recibir materiales externos','Resolver acceso al prototipo','Compartir el boceto aprobado','Descartar una prueba antigua'];
const statuses=['in_progress','pending','pending','pending_review','waiting_external','blocked','completed','cancelled']as const;
const tasks=[];
for(const [index,text] of titles.entries()){const task=await domain.capture({text,request_id:randomUUID(),project_id:index===2?null:String(project.id),priority:index===0?'critical':index===1?'high':index===4?'low':'normal'});await domain.updateTask(task.id,{status:statuses[index],sort_order:index,due_at:index===0?'2026-10-18':null});tasks.push(task);}
const child=await domain.capture({text:'Revisar la tipografía',request_id:randomUUID(),parent_task_id:tasks[0].id,project_id:String(project.id)});
const linked=await domain.capture({text:'Tarea vinculada desde el diario',request_id:randomUUID(),journal_date:today});
await domain.appendBlock(today,{text:'Nota ficticia para verificar la legibilidad del diario.',request_id:randomUUID(),revision:1});
await domain.setFocus('weekly','2026-10-12',tasks.slice(0,3).map(t=>t.id));await domain.setFocus('daily',today,tasks.slice(0,2).map(t=>t.id));
// Explicit ordering avoids random UUID ties after timestamp normalization.
await domain.updateTask(child.id,{sort_order:0.25});
await domain.updateTask(linked.id,{sort_order:0.5});
// Normalize fixture timestamps only in this isolated test schema.
for(const table of ['users','workspaces','workspace_members','strategic_goals','projects','milestones','tasks','journal_entries','journal_blocks','focus_items','idempotency_keys']){
 const columns=await db.all('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',[table])as {name:string}[];
 for(const column of ['created_at','updated_at','completed_at','cancelled_at','achieved_at'])if(columns.some(c=>c.name===column))await db.run(`UPDATE ${table} SET ${column}=$1 WHERE ${column} IS NOT NULL`,[fixed]);
}
// All entity lists need explicit order too: equal creation dates can expose UUID index ties.
for(const table of ['projects','strategic_goals','milestones'])await db.run(`UPDATE ${table} SET sort_order=storage_order`);
await db.run('UPDATE task_events SET occurred_at=$1',[fixed]);
const server=createApp(db).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();if(!address||typeof address==='string')throw Error('No isolated port');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const stableJSON=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const manifest:Record<string,{png:string;styles:string;elements:number}>={};let differences=0;
async function capture(page:Page,name:string){
 if(process.argv[5]&&!process.argv[5].split(',').some(state=>name.endsWith('-'+state)))return;
 await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await page.locator('input:focus,textarea:focus').evaluateAll(nodes=>nodes.forEach(node=>(node as HTMLElement).blur()));
 const fingerprint=await page.evaluate(()=>{
  const serialize=(style:CSSStyleDeclaration)=>Object.fromEntries(Array.from(style).map(property=>[property,style.getPropertyValue(property)]));
  return Array.from(document.body.querySelectorAll('*')).filter(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(node).visibility!=='hidden';}).map(node=>{
   const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
   return {tag:node.tagName,classes:node.getAttribute('class'),text:node.children.length===0?node.textContent?.trim():undefined,rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100),styles:serialize(style),before:serialize(getComputedStyle(node,'::before')),after:serialize(getComputedStyle(node,'::after'))};
  });
 });
 const json=stableJSON(fingerprint);writeFileSync(join(directory,`${name}.json`),json);
 const png=await page.screenshot({path:join(directory,`${name}.png`),fullPage:true,animations:'disabled',caret:'hide'});
 const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
 manifest[name]={png:digest(png),styles:digest(json),elements:fingerprint.length};
 if(phase==='compare'){
  const baselineFile=join(output,'baseline',`${name}.json`),baselinePng=join(output,'baseline',`${name}.png`);
  if(!existsSync(baselineFile)||!existsSync(baselinePng))throw Error(`Missing baseline ${name}`);
  const sameStyles=stableJSON(JSON.parse(readFileSync(baselineFile,'utf8')))===json,samePng=readFileSync(baselinePng).equals(png);
  if(!sameStyles||!samePng){differences++;console.log(`DIFFERENT ${name}: computed=${sameStyles?'equal':'changed'}, png=${samePng?'equal':'changed'}`);}
 }
}
try{
 const variants=[['desktop-es-light',1440,1050,'es','light','light'],['tablet-es-light',768,1024,'es','light','light'],['mobile-es-light',390,844,'es','light','light'],['desktop-en-dark',1440,1050,'en','dark','dark'],['mobile-en-system',360,800,'en','system','dark']]as const;
 if(process.argv[4]&&!variants.some(variant=>variant[0]===process.argv[4]))throw Error('Unknown visual variant');
 for(const [name,width,height,language,theme,colorScheme]of variants){
  if(process.argv[4]&&name!==process.argv[4])continue;
  await domain.preferences({language,theme,preferred_task_view:'table'});
  const context=await browser.newContext({baseURL:`http://127.0.0.1:${address.port}`,viewport:{width,height},colorScheme,reducedMotion:'reduce',locale:language==='es'?'es-ES':'en-GB'});
  try{
   const page=await context.newPage();await page.addInitScript('globalThis.__name = value => value');await page.clock.setFixedTime(new Date(fixed));await page.goto('/');await page.locator('.login-form').waitFor();await capture(page,`${name}-login`);
   await page.getByLabel(/correo|email/i).fill(email);await page.getByLabel(/contraseña|password/i).fill(password);await page.getByRole('button',{name:/entrar|sign in/i}).click();await page.locator('main h1').waitFor();
   for(const [section,path]of [['tasks','/'],['dashboard','/dashboard'],['journal','/journal'],['journal-entry',`/journal/${today}`],['projects','/projects'],['project-detail',`/projects/${project.id}`],['progress','/progress'],['archive','/archive'],['settings','/settings']]){
    await page.goto(path);await page.locator('main h1').waitFor();if(section==='progress'||section==='dashboard')await page.locator('.metrics-grid').waitFor();await capture(page,`${name}-${section}`);
   }
   await page.goto('/');await page.getByRole('button',{name:'Kanban',exact:true}).click();await capture(page,`${name}-kanban`);
   await page.goto('/');await page.getByRole('button',{name:title,exact:true}).click();await page.getByRole('dialog').waitFor();await capture(page,`${name}-task-editor`);await page.keyboard.press('Escape');
   if(width<651){await page.getByRole('button',{name:/capturar una tarea|capture a task/i,exact:true}).click();await page.getByRole('dialog').waitFor();await capture(page,`${name}-quick-capture`);}
  }finally{await context.close();}
 }
 writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(`${phase}: ${Object.keys(manifest).length} screenshots and computed-style fingerprints; ${differences} differences; ${directory}`);
 if(differences)process.exitCode=1;
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await fixture.close();
}
