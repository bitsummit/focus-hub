import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {Snapshot,Task} from '../shared/contracts.ts';
import {localDate,addDays} from '../server/calendar.ts';
const root='http://127.0.0.1:4173';
async function login(page:Page){
 await page.goto('/');await page.getByLabel(/correo/i).fill('browser@example.test');await page.getByLabel(/contraseña/i).fill('Browser-QA-fictional-2026!');await page.getByRole('button',{name:/entrar|iniciar sesión/i}).click();await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();
}
async function mutate(request:APIRequestContext,path:string,data:unknown,method='POST'):Promise<Snapshot>{
 const session=await (await request.get('/api/session')).json();
 const response=await request.fetch(path,{method,data,headers:{Origin:root,'X-CSRF-Token':session.csrfToken}});expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
async function capture(request:APIRequestContext,title:string):Promise<Task>{const state=await mutate(request,'/api/tasks',{text:title,request_id:randomUUID()});return state.tasks.find(t=>t.title===title)!;}
async function patch(page:Page,label:string,value:string){const response=page.waitForResponse(r=>r.url().includes('/api/tasks/')&&r.request().method()==='PATCH');await page.getByLabel(label,{exact:true}).selectOption(value);if(label.startsWith('Proyecto de '))await page.getByRole('alertdialog',{name:'Cambiar proyecto',exact:true}).getByRole('button',{name:'Confirmar',exact:true}).click();expect((await response).ok()).toBeTruthy();}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}

test('v1.1 rapid inbox capture, direct organization, chips, canonical completion and archive',async({page})=>{
 await login(page);const suffix=randomUUID().slice(0,8),names=Array.from({length:5},(_,i)=>`Captura ágil ${suffix} ${i+1}`),input=page.getByRole('textbox',{name:/captura rápida/i});
 for(const title of names){await input.fill(title);await input.press('Enter');await expect(input).toHaveValue('');await expect(input).toBeFocused();}
 await page.getByRole('button',{name:'Bandeja',exact:true}).click();await expect(page.getByRole('button',{name:'Bandeja',exact:true})).toHaveAttribute('aria-pressed','true');
 for(const title of names)await expect(page.getByRole('button',{name:title,exact:true})).toBeVisible();
 const state=await mutate(page.request,'/api/projects',{name:`Proyecto QA ${suffix}`}),project=state.projects.find(p=>p.name===`Proyecto QA ${suffix}`)!;
 await page.reload();await page.getByRole('button',{name:'Todas',exact:true}).click();
 for(const title of names)await patch(page,`Proyecto de ${title}`,project.id);
 await page.getByRole('button',{name:'Bandeja',exact:true}).click();await expect(page.getByRole('button',{name:names[0],exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Todas',exact:true}).click();
 const focused=state.tasks.find(t=>t.title===names[1])!;await mutate(page.request,`/api/focus/daily/${localDate(state.user.timezone)}`,{task_ids:[focused.id]},'PUT');await page.reload();await page.getByRole('button',{name:'Hoy',exact:true}).click();await expect(page.getByRole('button',{name:names[1],exact:true})).toBeVisible();await expect(page.getByRole('button',{name:names[0],exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Todas',exact:true}).click();await patch(page,`Prioridad de ${names[0]}`,'critical');await patch(page,`Estado de ${names[0]}`,'pending_review');
 await page.getByRole('button',{name:'Prioritarias',exact:true}).click();await expect(page.getByRole('button',{name:names[0],exact:true})).toBeVisible();await expect(page.getByRole('button',{name:names[1],exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'En espera',exact:true}).click();await expect(page.getByRole('button',{name:names[0],exact:true})).toBeVisible();await page.locator('.sidebar nav').getByRole('button',{name:'Tu espacio',exact:true}).click();await page.locator('.sidebar nav').getByRole('button',{name:/^Tareas/}).click();await expect(page.getByRole('button',{name:'En espera',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:names[0],exact:true})).toBeVisible();
 await page.getByLabel('Filtrar por estado',{exact:true}).selectOption('blocked');await page.getByLabel('Filtrar por prioridad',{exact:true}).selectOption('critical');await expect(page.getByText(/ninguna tarea coincide/i)).toBeVisible();await page.getByRole('button',{name:/limpiar/i}).first().click();
 await page.getByRole('checkbox',{name:`Completar ${names[0]}`,exact:true}).click();await expect(page.getByRole('button',{name:names[0],exact:true})).toHaveCount(0);
 await page.goto('/archive');await expect(page.getByRole('textbox',{name:'Buscar tareas',exact:true})).toBeVisible();await page.getByRole('textbox',{name:'Buscar tareas',exact:true}).fill(names[0]);await expect(page.getByRole('button',{name:new RegExp('^'+names[0])})).toBeVisible();
 const snapshot:Snapshot=await(await page.request.get('/api/state')).json();const task=snapshot.tasks.find(t=>t.title===names[0])!;expect(task.project_id).toBe(project.id);expect(task.completed_at).toBeTruthy();expect(snapshot.events.filter(e=>e.task_id===task.id&&e.event_type==='completed')).toHaveLength(1);
 await page.goto('/progress');await expect(page.getByText('Tareas completadas',{exact:true}).first()).toBeVisible();const analyticsRequest=await page.request.get(`/api/analytics?start=${localDate(snapshot.user.timezone)}&end=${addDays(localDate(snapshot.user.timezone),1)}`);expect(analyticsRequest.ok()).toBeTruthy();const analytics=await analyticsRequest.json();expect(analytics.achievements.some((event:{task_id:string})=>event.task_id===task.id)).toBeTruthy();
 await page.reload();const durable:Snapshot=await(await page.request.get('/api/state')).json();for(const title of names)expect(durable.tasks.filter(t=>t.title===title)).toHaveLength(1);
});

test('v1.1 mobile capture retains failed input, retries idempotently, supports consecutive saves and direct controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page);const title=`Captura móvil ${randomUUID().slice(0,8)}`;await page.getByRole('button',{name:'Capturar una tarea',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Captura rápida',exact:true}),input=dialog.getByLabel('Título de la tarea',{exact:true});await expect(input).toBeFocused();await input.fill(title);
 let first=true;await page.route('**/api/tasks',async route=>{if(route.request().method()==='POST'&&first){first=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEST_UNAVAILABLE',message:'Fallo ficticio recuperable'})});}else await route.continue();});
 await dialog.getByRole('button',{name:'Guardar y seguir',exact:true}).click();await expect(input).toHaveValue(title);await expect(dialog.getByRole('alert')).toContainText(/ficticio|guardar|error/i);
 await dialog.getByRole('button',{name:'Guardar y seguir',exact:true}).click();await expect(input).toHaveValue('');await expect(input).toBeFocused();await input.fill(title+' siguiente');await dialog.getByRole('button',{name:'Guardar y cerrar',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Bandeja',exact:true}).click();await expect(page.getByRole('button',{name:title,exact:true})).toBeVisible();await expect(page.getByRole('table')).toHaveCount(0);await noOverflow(page);
 await patch(page,`Estado de ${title}`,'blocked');await patch(page,`Prioridad de ${title}`,'high');await expect(page.getByLabel(`Estado de ${title}`,{exact:true})).toHaveValue('blocked');
 await page.getByRole('button',{name:title,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 // Lose the response AFTER SQLite commits: retry must reuse the capture ID, not create a second task.
 const ambiguousTitle=title+' respuesta perdida';let loseResponse=true;const requestIds:string[]=[];
 await page.route('**/api/tasks',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().text===ambiguousTitle){requestIds.push(route.request().postDataJSON().request_id);if(loseResponse){loseResponse=false;const committed=await route.fetch();expect(committed.ok()).toBeTruthy();await route.abort('failed');return;}}await route.continue();});
 await page.getByRole('button',{name:'Capturar una tarea',exact:true}).click();await input.fill(ambiguousTitle);await dialog.getByRole('button',{name:'Guardar y seguir',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText(/guardar|conexión/i);await expect(input).toHaveValue(ambiguousTitle);await dialog.getByRole('button',{name:'Guardar y cerrar',exact:true}).click();await expect(dialog).toHaveCount(0);expect(requestIds).toHaveLength(2);expect(requestIds[0]).toBe(requestIds[1]);
 const state:Snapshot=await(await page.request.get('/api/state')).json();expect(state.tasks.filter(t=>t.title===title)).toHaveLength(1);expect(state.tasks.find(t=>t.title===title)?.project_id).toBeNull();expect(state.tasks.filter(t=>t.title===ambiguousTitle)).toHaveLength(1);expect(state.events.filter(e=>e.task_id===state.tasks.find(t=>t.title===ambiguousTitle)!.id&&e.event_type==='created')).toHaveLength(1);
});

test('v1.1 Kanban renders 20 then 50 tasks in one state and 100 overall without clipping or duplicates',async({page})=>{
 test.setTimeout(120000);await login(page);const prefix=`Escala ${randomUUID().slice(0,8)}`;const records:Task[]=[];
 for(let i=0;i<100;i++){const t=await capture(page.request,`${prefix} ${String(i+1).padStart(3,'0')}`);records.push(t);if(i>=50)await mutate(page.request,`/api/tasks/${t.id}`,{status:'in_progress'},'PATCH');if(i===19){await page.reload();await page.getByRole('button',{name:'Kanban',exact:true}).click();await expect(page.locator('.board-column.status-pending').getByRole('button',{name:new RegExp(`^${prefix}`)})).toHaveCount(20);}}
 await page.reload();await page.getByRole('button',{name:'Kanban',exact:true}).click();
 const pending=page.locator('.board-column.status-pending');await expect(pending.getByRole('button',{name:new RegExp(`^${prefix}`)})).toHaveCount(50);await expect(page.locator('.board-column.status-in_progress').getByRole('button',{name:new RegExp(`^${prefix}`)})).toHaveCount(50);await expect(pending.getByRole('button',{name:`${prefix} 050`,exact:true})).toBeVisible();
 // Native browser DataTransfer drives the real desktop drag/drop handler and persists its transition.
 const transfer=await page.evaluateHandle(()=>new DataTransfer());const dragged=page.getByRole('button',{name:`${prefix} 049`,exact:true}).locator('xpath=ancestor::article');await dragged.dispatchEvent('dragstart',{dataTransfer:transfer});const moved=page.waitForResponse(r=>r.url().endsWith('/api/tasks/'+records[48].id)&&r.request().method()==='PATCH');await page.locator('.board-column.status-blocked').dispatchEvent('drop',{dataTransfer:transfer});expect((await moved).ok()).toBeTruthy();await transfer.dispose();await expect(page.locator('.board-column.status-blocked').getByRole('button',{name:`${prefix} 049`,exact:true})).toBeVisible();const movedState:Snapshot=await(await page.request.get('/api/state')).json();expect(movedState.tasks.find(t=>t.id===records[48].id)?.status).toBe('blocked');
 await page.setViewportSize({width:360,height:800});await noOverflow(page);const group=page.locator('details.status-pending');await expect(group).toHaveAttribute('open','');await group.locator('summary').click();await expect(page.getByRole('button',{name:`${prefix} 050`,exact:true})).toBeHidden();await group.locator('summary').click();await expect(page.getByRole('button',{name:`${prefix} 050`,exact:true})).toBeVisible();await patch(page,`Estado de ${prefix} 050`,'blocked');
 await page.reload();await expect(page.getByLabel(`Estado de ${prefix} 050`,{exact:true})).toHaveValue('blocked');
});

test('v1.1 responsive seven-section sweep, dark/light, long content and keyboard dialog focus',async({page,browser},testInfo)=>{
 test.setTimeout(180000);await login(page);const long=`Título extenso ficticio ${randomUUID()} para comprobar que el texto permanece legible sin colisiones ni desplazamiento horizontal en todas las resoluciones compatibles`;await capture(page.request,long);
 for(const theme of ['light','dark']){await mutate(page.request,'/api/preferences',{theme},'PATCH');for(const width of [360,390,430,768,1024,1440,1920]){await page.setViewportSize({width,height:width<768?844:1000});for(const path of ['/','/dashboard','/journal','/progress','/projects','/archive','/settings']){await page.goto(path);await expect(page.locator('h1')).toBeVisible();if(path==='/'){await expect(page.getByRole('textbox',{name:'Buscar tareas',exact:true})).toHaveCount(0);await expect(page.getByText('Filtros avanzados',{exact:true})).toHaveCount(0);for(const label of ['Filtrar por proyecto','Filtrar por estado','Filtrar por prioridad'])await expect(page.getByLabel(label,{exact:true})).toBeVisible();if(theme==='light'&&[390,1440].includes(width))await page.screenshot({path:testInfo.outputPath(`task-filters-${width}.png`)});}if(path==='/archive')await expect(page.getByRole('textbox',{name:'Buscar tareas',exact:true})).toBeVisible();await noOverflow(page);}}}
 await page.setViewportSize({width:844,height:390});await page.goto('/');await noOverflow(page);
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();await page.keyboard.press('Control+k');await expect(page.getByRole('textbox',{name:/captura rápida/i})).toBeFocused();await page.getByRole('button',{name:long,exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();for(let i=0;i<20;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBeTruthy();}await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 const snapshot=await page.locator('main').ariaSnapshot();expect(snapshot).toMatch(/Tareas/);expect(snapshot).toMatch(/Estado de/);expect(snapshot).toMatch(/Prioridad de/);expect(snapshot).toMatch(/Completar/);
 const touch=await browser.newContext({baseURL:root,viewport:{width:390,height:844},isMobile:true,hasTouch:true});try{await touch.addCookies(await page.context().cookies());const mobile=await touch.newPage();await mobile.goto('/');await expect(mobile.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();expect(await mobile.evaluate(()=>matchMedia('(pointer: coarse)').matches)).toBeTruthy();for(const control of [mobile.getByRole('checkbox',{name:`Completar ${long}`,exact:true}),mobile.getByLabel(`Proyecto de ${long}`,{exact:true}),mobile.getByLabel(`Estado de ${long}`,{exact:true}),mobile.getByLabel(`Prioridad de ${long}`,{exact:true}),mobile.getByRole('button',{name:'Capturar una tarea',exact:true})]){const box=await control.boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44);}}finally{await touch.close();}

});

test('v1.1 all seven status tokens meet AA text contrast in light and dark themes and persist between views',async({page})=>{
 await login(page);const task=await capture(page.request,`Color canónico ${randomUUID().slice(0,8)}`);await mutate(page.request,`/api/tasks/${task.id}`,{status:'pending_review'},'PATCH');
 for(const theme of ['light','dark']){
  await mutate(page.request,'/api/preferences',{theme},'PATCH');await page.goto('/');
  const contrast=await page.evaluate(()=>{
   const css=getComputedStyle(document.documentElement);
   const luminance=(hex:string)=>{const rgb=hex.trim().replace('#','').match(/.{2}/g)!.map(c=>parseInt(c,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
   return ['pending','in_progress','pending_review','waiting_external','blocked','completed','cancelled'].map(status=>{const fg=luminance(css.getPropertyValue(`--status-${status}-fg`)),bg=luminance(css.getPropertyValue(`--status-${status}-bg`));return {status,ratio:(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05)};});
  });for(const {status,ratio}of contrast)expect(ratio,`${theme} ${status} text contrast`).toBeGreaterThanOrEqual(4.5);
  const control=page.getByLabel(`Estado de ${task.title}`,{exact:true});const tableColor=await control.evaluate(el=>getComputedStyle(el).color);await expect(control).toHaveValue('pending_review');
  await page.getByRole('button',{name:'Kanban',exact:true}).click();await expect(control).toHaveValue('pending_review');expect(await control.evaluate(el=>getComputedStyle(el).color)).toBe(tableColor);
  await page.getByRole('button',{name:task.title,exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('combobox',{name:'Estado',exact:true})).toHaveValue('pending_review');await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Tabla',exact:true}).click();await expect(control).toHaveValue('pending_review');expect(await control.evaluate(el=>getComputedStyle(el).color)).toBe(tableColor);await page.setViewportSize({width:1280,height:900});
 }
});
