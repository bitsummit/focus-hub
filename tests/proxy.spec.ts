import {test,expect} from '@playwright/test';
import {createServer as createHTTP,request as requestHTTP} from 'node:http';
import {createServer as createHTTPS} from 'node:https';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTestDatabase} from './postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';
import {createApp} from '../server/app.ts';

test.use({ignoreHTTPSErrors:true});
for(const rewrittenScheme of ['http','https']as const){
test(`real HTTPS browser supports ${rewrittenScheme} localhost Origin rewrite, sign-out and rejection of cross-site login`,async({page})=>{
 const previous=Object.fromEntries(['CODESPACES','PORT','FOCUS_PUBLIC_ORIGIN','COOKIE_SECURE'].map(k=>[k,process.env[k]]));
 const dir=mkdtempSync(join(tmpdir(),'focus-proxy-browser-'));
 const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 process.env.CODESPACES='true';process.env.COOKIE_SECURE='true';process.env.FOCUS_PUBLIC_ORIGIN='https://127.0.0.1';
 const fixture=await createTestDatabase(),db=fixture.db;
 const credentials={email:'proxy-browser@example.test',password:'Fictional-Proxy-Browser-2026!'};await createOwner(db,credentials);
 const backend=createApp(db).listen(0,'127.0.0.1');await once(backend,'listening');
 const backendAddress=backend.address();if(!backendAddress||typeof backendAddress==='string')throw Error('Missing backend address');
 process.env.PORT=String(backendAddress.port);const internalHost=`localhost:${backendAddress.port}`;
 const proxy=createHTTPS({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
  const headers={...req.headers,host:internalHost};if(headers.origin)headers.origin=`${rewrittenScheme}://${internalHost}`;
  const upstream=requestHTTP({host:'127.0.0.1',port:backendAddress.port,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode!,response.headers);response.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);
 }).listen(0,'127.0.0.1');await once(proxy,'listening');const proxyAddress=proxy.address();if(!proxyAddress||typeof proxyAddress==='string')throw Error('Missing proxy address');
 const origin=`https://127.0.0.1:${proxyAddress.port}`;process.env.FOCUS_PUBLIC_ORIGIN=origin;
 const attacker=createHTTP((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<form method="POST" action="${origin}/api/session" target="attack"><input name="email" value="${credentials.email}"><input name="password" value="${credentials.password}"></form><iframe name="attack"></iframe>`);}).listen(0,'127.0.0.1');await once(attacker,'listening');const attackerAddress=attacker.address();if(!attackerAddress||typeof attackerAddress==='string')throw Error('Missing attacker address');
 try{
  await page.goto(origin);await page.getByLabel(/correo/i).fill(credentials.email);await page.getByLabel(/contraseña/i).fill(credentials.password);
  const loggedIn=page.waitForResponse(r=>r.url()===origin+'/api/session'&&r.request().method()==='POST');await page.getByRole('button',{name:/entrar en mi espacio/i}).click();expect((await loggedIn).status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Tabla',exact:true})).toHaveClass(/selected/);
  const capture=page.getByRole('textbox',{name:/captura rápida/i});await capture.fill('Captura browser proxy segura');await capture.press('Enter');await expect(capture).toHaveValue('');
  await page.goto(origin);await expect(page.getByRole('table')).toBeVisible();
  await page.goto(origin+'/tasks');await expect(page.getByRole('button',{name:'Captura browser proxy segura',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Captura browser proxy segura',exact:true})).toBeVisible();
  const cookie=(await page.context().cookies(origin)).find(c=>c.name==='focus_session'||c.name==='__Host-focus_session');expect(cookie?.secure).toBeTruthy();expect(cookie?.httpOnly).toBeTruthy();expect(cookie?.sameSite).toBe('Strict');
  await page.goto(`http://127.0.0.1:${attackerAddress.port}`);const attacked=page.waitForResponse(r=>r.url()===origin+'/api/session'&&r.request().method()==='POST');await page.locator('form').evaluate((form:HTMLFormElement)=>form.submit());expect((await attacked).status()).toBe(403);
  await page.goto(origin);await expect(page.getByRole('textbox',{name:/captura rápida/i})).toBeVisible();
  // Exercise the actual sign-out control through the same observed Codespaces Origin/Host rewrite.
  const beforeLogout=await(await page.request.get(origin+'/api/state')).json();
  const savedTask=beforeLogout.tasks.find((task:{title:string})=>task.title==='Captura browser proxy segura');expect(savedTask?.id).toBeTruthy();
  const signedOut=page.waitForResponse(response=>response.url()===origin+'/api/session'&&response.request().method()==='DELETE');
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
  const logout=await signedOut;expect(logout.request().headers()['x-csrf-token']).toBeTruthy();expect(logout.status()).toBe(200);expect(await logout.json()).toEqual({ok:true});
  await expect(page.getByRole('heading',{name:'Bienvenido de nuevo',exact:true})).toBeVisible();
  expect((await page.request.get(origin+'/api/session')).status()).toBe(401);
  expect((await page.context().cookies(origin)).some(cookie=>cookie.name==='focus_session'||cookie.name==='__Host-focus_session')).toBeFalsy();
  await page.reload();await expect(page.getByRole('heading',{name:'Bienvenido de nuevo',exact:true})).toBeVisible();
  expect((await page.request.get(origin+'/api/session')).status()).toBe(401);
  await page.getByLabel(/correo/i).fill(credentials.email);await page.getByLabel(/contraseña/i).fill(credentials.password);
  const reloggedIn=page.waitForResponse(response=>response.url()===origin+'/api/session'&&response.request().method()==='POST');
  await page.getByRole('button',{name:/entrar en mi espacio/i}).click();expect((await reloggedIn).status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Tareas',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Captura browser proxy segura',exact:true})).toBeVisible();
  const afterLogin=await(await page.request.get(origin+'/api/state')).json();
  expect(afterLogin.tasks.filter((task:{title:string})=>task.title==='Captura browser proxy segura')).toHaveLength(1);
  expect(afterLogin.tasks.find((task:{title:string})=>task.title==='Captura browser proxy segura').id).toBe(savedTask.id);
 }finally{
  await page.goto('about:blank');
  for(const server of [attacker,proxy,backend]){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  await fixture.close();rmSync(dir,{recursive:true,force:true});for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
}
