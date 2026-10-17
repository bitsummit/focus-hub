import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function login(page:Page){
 await page.goto('/');
 await page.getByLabel(/correo/i).fill('browser@example.test');
 await page.getByLabel(/contraseña/i).fill('Browser-QA-fictional-2026!');
 await page.getByRole('button',{name:/entrar|iniciar sesión/i}).click();
 await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();
}
test('01,14,15: real browser keyboard capture survives refresh and appears in table and board',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await login(page);
 const capture=page.getByRole('textbox',{name:/captura rápida/i});
 await capture.fill('Captura teclado QA');await capture.press('Enter');await expect(capture).toHaveValue('');
 await page.locator('.sidebar').getByRole('button',{name:/^Tareas/}).click();
 await expect(page.getByText('Captura teclado QA',{exact:true}).first()).toBeVisible();
 await page.reload();await expect(page.getByText('Captura teclado QA',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Tabla',exact:true}).click();
 await expect(page.getByRole('table')).toBeVisible();
 await expect(page.getByRole('row').filter({hasText:'Captura teclado QA'})).toBeVisible();
 await page.getByRole('button',{name:'Kanban',exact:true}).click();
 await expect(page.getByText('Captura teclado QA',{exact:true}).first()).toBeVisible();
 expect(errors).toEqual([]);
});
test('tasks table is the landing page despite a legacy board preference and desktop navigation keeps Dashboard second',async({page})=>{
 await login(page);
 // Exercise the persisted legacy preference through the real settings form.
 await page.goto('/settings');await page.getByRole('combobox',{name:'Vista de tareas',exact:true}).selectOption('board');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/preferences')&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'Guardar preferencias',exact:true}).click();expect((await saved).ok()).toBeTruthy();
 await page.goto('/tasks');await expect(page.getByRole('button',{name:'Kanban',exact:true})).toHaveClass(/selected/);
 await page.goto('/');await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();
 await expect(page.getByRole('table')).toBeVisible();
 await expect(page.getByRole('button',{name:'Tabla',exact:true})).toHaveClass(/selected/);
 await page.reload();await expect(page.getByRole('table')).toBeVisible();
 const sidebar=page.locator('.sidebar nav');
 await expect(sidebar.getByRole('button')).toHaveText([/^Tareas\s*\d*$/,'Mi espacio','Diario','Avances','Proyectos','Archivo','Ajustes']);
 await sidebar.getByRole('button',{name:'Mi espacio',exact:true}).click();
 await expect(page).toHaveURL(/\/dashboard$/);await expect(page.getByRole('heading',{name:'Mi espacio',exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('.weekly-panel')).toBeVisible();
 await sidebar.getByRole('button',{name:/^Tareas/}).click();await expect(page).toHaveURL(/\/tasks$/);
 await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByRole('heading',{name:'Mi espacio',exact:true})).toBeVisible();
 await page.goForward();await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();
 await page.locator('.sidebar .brand').click();await expect(page).toHaveURL(/\/$/);
 await expect(page.getByRole('table')).toBeVisible();
});
test('14: smartphone navigation, keyboard operation, readable sections and no page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page);
 for(const path of ['/','/tasks','/dashboard','/projects','/journal','/progress','/archive','/settings']){
  await page.goto(path);await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`page overflow on ${path}`).toBeTruthy();
 }
 await page.goto('/');
 const mobile=page.locator('.mobile-nav');
 await expect(mobile.getByRole('button')).toHaveText(['Tareas','Mi espacio','Diario','Avances','Más']);
 await mobile.getByRole('button',{name:'Mi espacio',exact:true}).click();
 await expect(page).toHaveURL(/\/dashboard$/);await expect(page.getByRole('heading',{name:'Mi espacio',exact:true})).toBeVisible();
 await mobile.getByRole('button',{name:'Más',exact:true}).click();
 await expect(page.locator('.mobile-more').getByRole('button')).toHaveText(['Proyectos','Archivo','Ajustes']);
 await page.locator('.mobile-more').getByRole('button',{name:'Proyectos',exact:true}).click();
 await expect(page).toHaveURL(/\/projects$/);await expect(page.locator('.mobile-more')).toHaveCount(0);
 await page.goBack();await expect(page.getByRole('heading',{name:'Mi espacio',exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Lista de tareas'})).toBeVisible();
 await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe('BODY');
});
test('02,03,04,05,07,08,12: journal canonical task, board/table state, focus, archive and real downloads',async({page})=>{
 await login(page);await page.goto('/projects');
 await page.getByRole('button',{name:'Nuevo proyecto',exact:true}).click();
 await page.getByLabel('Nombre',{exact:true}).fill('SRA');
 await page.getByRole('button',{name:'Guardar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'SRA',exact:true})).toBeVisible();
 await page.goto('/journal/2026-10-15');
 async function append(text:string){const input=page.getByRole('textbox',{name:'Escribir en el diario'});await input.fill(text);await input.press('Enter');await expect(input).toHaveValue('');}
 await append('# SRA');await append('Nota ficticia conservada.');await append('- [ ] !! Presentación canónica QA #SRA');
 await page.getByLabel('Indentación del bloque').selectOption('1');await append('- [ ] Subtarea canónica QA');
 await page.reload();await expect(page.getByRole('button',{name:'SRA',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Nota ficticia conservada.',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Presentación canónica QA/})).toHaveCount(1);
 await page.goto('/tasks');
 const status=page.getByLabel('Estado de Presentación canónica QA',{exact:true});
 for(const value of ['in_progress','pending_review']){const saved=page.waitForResponse(r=>r.url().includes('/api/tasks/')&&r.request().method()==='PATCH');await status.selectOption(value);expect((await saved).ok()).toBeTruthy();await expect(status).toHaveValue(value);}
 await page.getByRole('button',{name:'Tabla',exact:true}).click();await expect(page.getByLabel('Estado de Presentación canónica QA',{exact:true})).toHaveValue('pending_review');
 await page.goto('/journal/2026-10-15');await page.getByRole('button',{name:/^Presentación canónica QA/}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('combobox',{name:'Estado',exact:true})).toHaveValue('pending_review');await expect(dialog.getByRole('combobox',{name:'Prioridad',exact:true})).toHaveValue('critical');
 await dialog.getByRole('combobox',{name:'Estado',exact:true}).selectOption('waiting_external');await dialog.getByLabel('Seguimiento',{exact:true}).fill('2026-10-20');await dialog.getByLabel('En espera de',{exact:true}).fill('Respuesta ficticia');await dialog.getByRole('button',{name:'Guardar cambios'}).click();await expect(dialog).toHaveCount(0);
 await page.goto('/dashboard');const weekly=page.locator('.weekly-panel');await weekly.getByRole('button',{name:/Elegir tarea/}).click();await page.locator('#focus-weekly').selectOption({label:'Presentación canónica QA'});await expect(weekly.getByRole('button',{name:/^Presentación canónica QA/})).toBeVisible();
 await page.reload();await expect(weekly.getByRole('button',{name:/^Presentación canónica QA/})).toBeVisible();
 await page.goto('/tasks');await page.getByRole('button',{name:'Tabla',exact:true}).click();const completed=page.waitForResponse(r=>r.url().includes('/api/tasks/')&&r.request().method()==='PATCH');await page.getByRole('checkbox',{name:'Completar Presentación canónica QA',exact:true}).click();expect((await completed).ok()).toBeTruthy();
 await page.goto('/archive');await expect(page.getByRole('button',{name:/^Presentación canónica QA/})).toBeVisible();await expect(page.getByText(/Finalización:/)).toBeVisible();
 await page.goto('/settings');
 const jsonDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar todo · JSON'}).click();const json=await jsonDownload;const exported=JSON.parse(await readFile((await json.path())!,'utf8'));const task=exported.tasks.find((t:any)=>t.title==='Presentación canónica QA');expect(task.completed_at).toBeTruthy();expect(exported.tasks.filter((t:any)=>t.title===task.title)).toHaveLength(1);expect(exported.blocks.filter((b:any)=>b.task_id===task.id)).toHaveLength(1);expect(exported.events.some((e:any)=>e.task_id===task.id&&e.event_type==='completed')).toBeTruthy();
 const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar tareas · CSV'}).click();const csv=await csvDownload;expect(await readFile((await csv.path())!,'utf8')).toContain(task.id);
});
test('parallel tabs preserve remote task changes and reject stale journal edits',async({page})=>{
 await login(page);const capture=page.getByRole('textbox',{name:/captura rápida/i});await capture.fill('Tarea entre pestañas QA');await capture.press('Enter');await expect(capture).toHaveValue('');
 await page.goto('/tasks');await page.getByRole('button',{name:'Tarea entre pestañas QA',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Descripción',{exact:true}).fill('Descripción local conservada');
 const remote=await page.context().newPage();await remote.goto('/tasks');const saved=remote.waitForResponse(r=>r.url().includes('/api/tasks/')&&r.request().method()==='PATCH');await remote.getByLabel('Estado de Tarea entre pestañas QA',{exact:true}).selectOption('pending_review');expect((await saved).ok()).toBeTruthy();
 const refetched=page.waitForResponse(r=>r.url().endsWith('/api/state'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await refetched;
 await dialog.getByRole('button',{name:'Guardar cambios'}).click();await expect(dialog).toHaveCount(0);await expect(page.getByLabel('Estado de Tarea entre pestañas QA',{exact:true})).toHaveValue('pending_review');
 await page.goto('/journal/2026-10-14');const composer=page.getByRole('textbox',{name:'Escribir en el diario'});await composer.fill('Nota para probar concurrencia');await composer.press('Enter');await expect(composer).toHaveValue('');await page.getByRole('button',{name:'Nota para probar concurrencia',exact:true}).click();await page.getByLabel('Editar bloque',{exact:true}).fill('Cambio local obsoleto');
 await remote.goto('/journal/2026-10-14');await remote.getByRole('button',{name:'Nota para probar concurrencia',exact:true}).click();await remote.getByLabel('Editar bloque',{exact:true}).fill('Cambio remoto vigente');await remote.getByRole('button',{name:'Guardar bloque',exact:true}).click();await expect(remote.getByRole('button',{name:'Cambio remoto vigente',exact:true})).toBeVisible();
 const refresh=page.waitForResponse(r=>r.url().endsWith('/api/state'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await refresh;
 const conflict=page.waitForResponse(r=>r.url().includes('/api/blocks/')&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Guardar bloque',exact:true}).click();expect((await conflict).status()).toBe(409);await expect(page.getByRole('alert')).toContainText(/cambiado/i);
 await page.reload();await expect(page.getByRole('button',{name:'Cambio remoto vigente',exact:true})).toBeVisible();await expect(page.getByText('Cambio local obsoleto',{exact:true})).toHaveCount(0);await remote.close();
});
