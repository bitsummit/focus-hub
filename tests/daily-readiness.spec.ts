import {test,expect,type Page} from '@playwright/test';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createTestDatabase} from './postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';

const root=resolve('.'),cli=fileURLToPath(new URL('../scripts/postgres-database.ts',import.meta.url));
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const email='daily-recovery@example.test',password='Fictional-Daily-Recovery-2026!';
async function freePort(){const server=createServer().listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('Missing fixture port');await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));return address.port;}
async function stop(child:ChildProcess|undefined){if(!child||child.exitCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);try{await exited;}finally{clearTimeout(timeout);}}
async function login(page:Page,origin:string){await page.goto(origin);await page.getByLabel(/correo/i).fill(email);await page.getByLabel(/contraseña/i).fill(password);await page.getByRole('button',{name:/entrar|iniciar sesión/i}).click();await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();}
async function state(page:Page){return page.evaluate(async()=>{const response=await fetch('/api/state');if(!response.ok)throw Error('state '+response.status);return response.json();});}
async function logout(page:Page){await page.evaluate(async()=>{const session=await(await fetch('/api/session')).json();const response=await fetch('/api/session',{method:'DELETE',headers:{'X-CSRF-Token':session.csrfToken}});if(!response.ok)throw Error('logout '+response.status);});await page.reload();await expect(page.getByLabel(/correo/i)).toBeVisible();}

test('daily use: actual process restart, logout and PostgreSQL recovery preserve canonical tasks and history',async({page})=>{
 test.setTimeout(90000);
 const dir=mkdtempSync(join(tmpdir(),'focus-daily-recovery-')),backup=join(dir,'backup.json');
 const source=await createTestDatabase(),restored=await createTestDatabase(),db=source.db;
 const user=await createOwner(db,{email,password,display_name:'Persona ficticia de recuperación'});
 const workspace=String((await db.one('SELECT id FROM workspaces'))!.id),domain=new Domain(db,{user_id:user.id,workspace_id:workspace});
 const project=await domain.createEntity('projects',{name:'Proyecto recuperación ficticio'});
 const canonical=await domain.capture({text:'Tarea canónica recuperable',project_id:project.id,request_id:randomUUID(),journal_date:'2026-10-16'});
 await domain.updateTask(canonical.id,{status:'completed'});await domain.updateTask(canonical.id,{status:'pending_review'});
 const reference=(await domain.snapshot()).blocks.find(block=>block.task_id===canonical.id)!;
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;let child:ChildProcess|undefined,output='';
 async function start(fixture:Awaited<ReturnType<typeof createTestDatabase>>){
  const env:NodeJS.ProcessEnv={...process.env,PORT:String(port),DATABASE_URL:fixture.url,DATABASE_SCHEMA:fixture.schema,FOCUS_DEV:'false',CODESPACES:'false',FOCUS_PUBLIC_ORIGIN:'',COOKIE_SECURE:'false'};delete env.FOCUS_DB;
  child=spawn(process.execPath,['--import',loader,join(root,'server/index.ts')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data',data=>{output+=String(data);});child.stderr?.on('data',data=>{output+=String(data);});
  await expect.poll(async()=>{if(child!.exitCode!==null)throw Error('Own server exited: '+output);try{return(await fetch(origin+'/api/health')).status;}catch{return 0;}},{timeout:20000}).toBe(200);
 }
 function runCLI(args:string[],fixture=source){const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:fixture.url,DATABASE_SCHEMA:fixture.schema};delete env.FOCUS_DB;const result=spawnSync(process.execPath,['--import',loader,cli,...args],{cwd:dir,encoding:'utf8',env});expect(result.status,result.stderr).toBe(0);return JSON.parse(result.stdout);}
 try {
  await start(source);await login(page,origin);
  const capture=page.getByRole('textbox',{name:/captura rápida/i});await capture.fill('Captura navegador duradera');await capture.press('Enter');await expect(capture).toHaveValue('');
  await expect(page.getByRole('button',{name:'Captura navegador duradera',exact:true}).first()).toBeVisible();
  let current=await state(page);const captured=current.tasks.find((task:any)=>task.title==='Captura navegador duradera');expect(captured).toBeTruthy();
  await page.reload();expect((await state(page)).tasks.some((task:any)=>task.id===captured.id)).toBeTruthy();
  await logout(page);await login(page,origin);expect((await state(page)).tasks.some((task:any)=>task.id===captured.id)).toBeTruthy();
  await stop(child);child=undefined;await start(source);await page.reload();
  // Durable sessions are read from the same PostgreSQL schema after a real process restart.
  await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();current=await state(page);expect(current.tasks.some((task:any)=>task.id===captured.id)).toBeTruthy();
  const report=runCLI(['backup','--out',backup]);expect(report.counts.tasks).toBe(2);
  await stop(child);child=undefined;
  const recovered=runCLI(['restore','--source',backup],restored);expect(recovered.counts.sessions).toBe(0);expect(recovered.sessionsRevoked).toBeGreaterThan(0);
  runCLI(['verify','--source',backup]);await start(restored);await page.reload();await expect(page.getByLabel(/correo/i)).toBeVisible();await login(page,origin);
  current=await state(page);expect(current.tasks.find((task:any)=>task.id===canonical.id)).toMatchObject({title:'Tarea canónica recuperable',project_id:project.id,status:'pending_review'});
  expect(current.projects.some((item:any)=>item.id===project.id)).toBeTruthy();expect(current.blocks.find((block:any)=>block.id===reference.id)).toMatchObject({task_id:canonical.id,journal_entry_id:reference.journal_entry_id});
  expect(current.tasks.filter((task:any)=>task.id===captured.id)).toHaveLength(1);expect(current.events.some((event:any)=>event.task_id===canonical.id&&event.event_type==='completed')).toBeTruthy();expect(current.events.some((event:any)=>event.task_id===canonical.id&&event.event_type==='reopened')).toBeTruthy();
  await page.goto(origin+'/journal/2026-10-16');await expect(page.getByRole('button',{name:/^Tarea canónica recuperable/})).toBeVisible();
  await page.goto(origin+'/tasks');await expect(page.getByRole('button',{name:'Captura navegador duradera',exact:true}).first()).toBeVisible();
 }finally{await stop(child);await restored.close();await source.close();rmSync(dir,{recursive:true,force:true});}
});
