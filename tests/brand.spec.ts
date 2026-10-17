import {test,expect,type Page} from '@playwright/test';
const account={email:'brand-browser@example.test',password:'Brand-QA-fictional-2026!'};
async function login(page:Page){await page.goto('/');await page.getByLabel(/correo|email/i).fill(account.email);await page.getByLabel(/contraseña|password/i).fill(account.password);await page.getByRole('button',{name:/entrar|sign in|log in/i}).click();await expect(page.locator('h1')).toHaveText(/^(Tareas|Tasks)$/);}
async function preferences(page:Page,data:Record<string,string>){const session=await(await page.request.get('/api/session')).json();const response=await page.request.patch('/api/preferences',{data,headers:{Origin:'http://127.0.0.1:4173','X-CSRF-Token':session.csrfToken}});expect(response.ok(),await response.text()).toBeTruthy();}
async function fitsViewport(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}

test('Focus. signed-out identity uses self-hosted Manrope and canonical accessible mark with external requests blocked',async({page})=>{
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4173/')?route.continue():route.abort());
 await page.goto('/');await expect(page).toHaveTitle('Focus.');
 const logo=page.locator('.login-story .brand-logo');await expect(logo).toHaveAccessibleName('Focus.');await expect(logo.locator('.brand-word')).toHaveText('Focus.');await expect(logo.locator('.brand-dot')).toHaveText('.');
 await expect(page.getByText('Quiet the noise. Find clarity.',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Bienvenido de nuevo',exact:true})).toBeVisible();
 await expect(page.locator('.login-story h1')).toHaveText(/Tareas,\s*proyectos y\s*progreso\./);
 await expect(page.locator('.login-layout')).not.toContainText(/Focus Hub|TUS CREDENCIALES|TU ESPACIO PERSONAL|comando de administración|Introduce tus credenciales/i);
 await page.evaluate(()=>document.fonts.ready);expect(await logo.locator('.brand-word').evaluate(element=>({family:getComputedStyle(element).fontFamily,weight:getComputedStyle(element).fontWeight,color:getComputedStyle(element).color}))).toEqual({family:expect.stringContaining('Manrope'),weight:'800',color:'rgb(41, 59, 57)'});
 expect(await page.evaluate(()=>Array.from(document.fonts).some(font=>font.family.replaceAll('"','').includes('Manrope')&&font.status==='loaded'))).toBeTruthy();
 await expect(logo.locator('.brand-dot')).toHaveCSS('color','rgb(57, 121, 106)');
 const icon=page.locator('link[rel="icon"]');await expect(icon).toHaveAttribute('href','/brand-symbol.svg');const response=await page.request.get('/brand-symbol.svg');expect(response.ok()).toBeTruthy();expect(response.headers()['content-type']).toContain('image/svg+xml');expect(await response.text()).toContain('<svg');
 for(const colorScheme of ['light','dark']as const){await page.emulateMedia({colorScheme});for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:width<500?844:1000});await expect(logo).toBeVisible();await expect(page.getByLabel(/correo/i)).toBeVisible();await expect(page.getByLabel(/contraseña/i)).toBeVisible();await fitsViewport(page);
  for(const label of await page.locator('.login-form label').all()){
   const contrast=await label.evaluate(element=>{
    const rgb=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const luminance=(color:number[])=>color.map(channel=>{const value=channel/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    let ancestor:Element|null=element;let background='rgb(255, 255, 255)';
    while(ancestor){const candidate=getComputedStyle(ancestor).backgroundColor;if(candidate!=='rgba(0, 0, 0, 0)'&&candidate!=='transparent'){background=candidate;break;}ancestor=ancestor.parentElement;}
    const text=luminance(rgb(getComputedStyle(element).color)),surface=luminance(rgb(background));return(Math.max(text,surface)+.05)/(Math.min(text,surface)+.05);
   });expect(contrast,`${colorScheme} ${width}px login label contrast`).toBeGreaterThanOrEqual(4.5);
  }
 }}
});

test('shared Focus. branding and Mi espacio / My space remain usable across languages, themes and responsive navigation',async({page})=>{
 test.setTimeout(90000);await login(page);
 try{
  for(const language of ['es','en'])for(const theme of ['light','dark']){
   await preferences(page,{language,theme});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:width<500?844:1000});await page.goto('/dashboard');await expect(page).toHaveTitle('Focus.');await expect(page.getByRole('heading',{name:language==='es'?'Mi espacio':'My space',exact:true})).toBeVisible();await fitsViewport(page);
    await expect(page.locator('body')).not.toContainText(/Focus Hub|Tu espacio|Your workspace/);
    const navigation=page.locator(width<768?'.mobile-nav':'.sidebar nav');await expect(navigation.getByRole('button',{name:language==='es'?'Mi espacio':'My space',exact:true})).toBeVisible();
    if(width<768){const mobileBrand=page.locator('.mobile-header-brand.brand-logo');await expect(mobileBrand).toBeVisible();await expect(mobileBrand).toHaveAccessibleName('Focus.');await expect(mobileBrand.locator('.brand-symbol')).toHaveAttribute('src','/brand-symbol.svg');}
    if(width>=768){const logo=page.locator('.sidebar .brand-logo');await expect(logo).toBeVisible();await expect(logo).toHaveAccessibleName('Focus.');await expect(logo.locator('.brand-dot')).toHaveCSS('color','rgb(57, 121, 106)');await page.locator('.sidebar .brand').click();await expect(page).toHaveURL(/\/$/);await expect(page.getByRole('heading',{name:language==='es'?'Tareas':'Tasks',exact:true})).toBeVisible();}
   }
  }
  await page.locator('.sidebar').getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByText('Quiet the noise. Find clarity.',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();await login(page);
 }finally{await preferences(page,{language:'es',theme:'system'});}
});
