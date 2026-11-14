/** Real browser evidence with fictional records in a disposable PostgreSQL schema. */
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
const email='brand-screenshots@example.test',password=randomBytes(30).toString('base64url');
const user=await createOwner(db,{email,password,display_name:'Cuenta ficticia'});
const workspace=await db.one('SELECT id FROM workspaces WHERE owner_user_id=$1',[user.id])as{id:string};
const domain=new Domain(db,{user_id:user.id,workspace_id:workspace.id});
const project=await domain.createEntity('projects',{name:'Estudio Aurora',description:'Proyecto ficticio de diseño',color:'#39796a'});
const tasks=[];
for(const [index,text] of ['Preparar la propuesta visual','Elegir referencias para el proyecto','Revisar las notas de la semana'].entries())tasks.push(await domain.capture({text,request_id:randomUUID(),project_id:String(project.id),priority:index===0?'high':'normal'}));
await domain.updateTask(tasks[0].id,{status:'in_progress'});
const today=localDate(user.timezone);await domain.setFocus('weekly',periodStart(today,'weekly',user.week_start_day),tasks.map(task=>task.id));await domain.setFocus('daily',today,tasks.slice(0,2).map(task=>task.id));
const server=createApp(db).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing isolated fixture port');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const output=resolve(process.argv[2]||'test-results/brand');mkdirSync(output,{recursive:true});
let minimumLabelContrast=Infinity;
try{
 for(const theme of ['light','dark']as const)for(const [mode,width,height]of [['desktop',1440,1050],['mobile',390,844]]as const){
  const context=await browser.newContext({baseURL:`http://127.0.0.1:${address.port}`,viewport:{width,height},colorScheme:theme});
  try{const page=await context.newPage();await page.goto('/');await page.getByRole('heading',{name:'Bienvenido de nuevo',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
   const ratios=await page.evaluate<number[]>(`Array.from(document.querySelectorAll('.login-form label')).map(element=>{
    const rgb=(value)=>value.match(/[0-9.]+/g).slice(0,3).map(Number);
    const luminance=(color)=>color.map(channel=>{const value=channel/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    let ancestor=element;let background='rgb(255, 255, 255)';
    while(ancestor){const candidate=getComputedStyle(ancestor).backgroundColor;if(candidate!=='rgba(0, 0, 0, 0)'&&candidate!=='transparent'){background=candidate;break;}ancestor=ancestor.parentElement;}
    const text=luminance(rgb(getComputedStyle(element).color)),surface=luminance(rgb(background));return(Math.max(text,surface)+.05)/(Math.min(text,surface)+.05);
   })`);minimumLabelContrast=Math.min(minimumLabelContrast,...ratios);
   await page.screenshot({path:join(output,`login-${mode}-${theme}.png`),fullPage:true});
   await domain.preferences({theme,language:'es'});await page.getByLabel(/correo/i).fill(email);await page.getByLabel(/contraseña/i).fill(password);await page.getByRole('button',{name:/entrar/i}).click();await page.getByRole('heading',{name:'Tareas',exact:true}).waitFor();await page.goto('/dashboard');await page.getByRole('heading',{name:'Mi espacio',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(output,`app-${mode}-${theme}.png`),fullPage:true});
  }finally{await context.close();}
 }
 console.log(`8 real Chromium screenshots saved to ${output}; isolated fictional database removed on exit. Minimum login label contrast: ${minimumLabelContrast.toFixed(2)}:1.`);
}finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await fixture.close();}
