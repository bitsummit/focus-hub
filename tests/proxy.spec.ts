import {test,expect} from '@playwright/test';
import {createServer as createHTTP,request as requestHTTP} from 'node:http';
import {createServer as createHTTPS} from 'node:https';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';
import {createApp} from '../server/app.ts';

test.use({ignoreHTTPSErrors:true});
test('real HTTPS browser works behind localhost Origin rewrite while a cross-site login is rejected',async({page})=>{
 const previous=Object.fromEntries(['CODESPACES','PORT','FOCUS_PUBLIC_ORIGIN','COOKIE_SECURE'].map(k=>[k,process.env[k]]));
 const dir=mkdtempSync(join(tmpdir(),'focus-proxy-browser-'));
 const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 process.env.CODESPACES='true';process.env.COOKIE_SECURE='true';process.env.FOCUS_PUBLIC_ORIGIN='https://127.0.0.1';
 const db=openDatabase(join(dir,'fixture.sqlite'));
 const credentials={email:'proxy-browser@example.test',password:'Fictional-Proxy-Browser-2026!'};createOwner(db,credentials);
 const backend=createApp(db).listen(0,'127.0.0.1');await once(backend,'listening');
 const backendAddress=backend.address();if(!backendAddress||typeof backendAddress==='string')throw Error('Missing backend address');
 process.env.PORT=String(backendAddress.port);const internalHost=`localhost:${backendAddress.port}`;
 const proxy=createHTTPS({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
  const headers={...req.headers,host:internalHost};if(headers.origin)headers.origin=`http://${internalHost}`;
  const upstream=requestHTTP({host:'127.0.0.1',port:backendAddress.port,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode!,response.headers);response.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);
 }).listen(0,'127.0.0.1');await once(proxy,'listening');const proxyAddress=proxy.address();if(!proxyAddress||typeof proxyAddress==='string')throw Error('Missing proxy address');
 const origin=`https://127.0.0.1:${proxyAddress.port}`;process.env.FOCUS_PUBLIC_ORIGIN=origin;
 const attacker=createHTTP((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<form method="POST" action="${origin}/api/session" target="attack"><input name="email" value="${credentials.email}"><input name="password" value="${credentials.password}"></form><iframe name="attack"></iframe>`);}).listen(0,'127.0.0.1');await once(attacker,'listening');const attackerAddress=attacker.address();if(!attackerAddress||typeof attackerAddress==='string')throw Error('Missing attacker address');
 try{
  await page.goto(origin);await page.getByLabel(/correo/i).fill(credentials.email);await page.getByLabel(/contraseña/i).fill(credentials.password);
  const loggedIn=page.waitForResponse(r=>r.url()===origin+'/api/session'&&r.request().method()==='POST');await page.getByRole('button',{name:/entrar en mi espacio/i}).click();expect((await loggedIn).status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Tus tareas',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Tabla',exact:true})).toHaveClass(/selected/);
  const capture=page.getByRole('textbox',{name:/captura rápida/i});await capture.fill('Captura browser proxy segura');await capture.press('Enter');await expect(capture).toHaveValue('');
  await page.goto(origin);await expect(page.getByRole('table')).toBeVisible();
  await page.goto(origin+'/tasks');await expect(page.getByRole('button',{name:'Captura browser proxy segura',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Captura browser proxy segura',exact:true})).toBeVisible();
  const cookie=(await page.context().cookies(origin)).find(c=>c.name==='focus_session'||c.name==='__Host-focus_session');expect(cookie?.secure).toBeTruthy();expect(cookie?.httpOnly).toBeTruthy();expect(cookie?.sameSite).toBe('Strict');
  await page.goto(`http://127.0.0.1:${attackerAddress.port}`);const attacked=page.waitForResponse(r=>r.url()===origin+'/api/session'&&r.request().method()==='POST');await page.locator('form').evaluate((form:HTMLFormElement)=>form.submit());expect((await attacked).status()).toBe(403);
  await page.goto(origin);await expect(page.getByRole('textbox',{name:/captura rápida/i})).toBeVisible();
 }finally{
  await page.goto('about:blank');
  for(const server of [attacker,proxy,backend]){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  db.close();rmSync(dir,{recursive:true,force:true});for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
