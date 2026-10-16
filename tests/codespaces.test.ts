import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/db.ts';
import {createOwner} from '../server/auth.ts';
import {createApp} from '../server/app.ts';

const publicOrigin='https://fictional-focus-3000.app.github.dev';
const credentials={email:'codespaces-qa@example.test',password:'Fictional-Codespaces-QA-2026!'};

/** Exercises real HTTP requests with a proxy's external Origin and internal Host.
 * This verifies the application contract, not GitHub provisioning or forwarding. */
async function fixture(configuredOrigin?:string) {
 const previous={origin:process.env.FOCUS_PUBLIC_ORIGIN,secure:process.env.COOKIE_SECURE};
 if(configuredOrigin===undefined)delete process.env.FOCUS_PUBLIC_ORIGIN;else process.env.FOCUS_PUBLIC_ORIGIN=configuredOrigin;
 process.env.COOKIE_SECURE=configuredOrigin?'true':'false';
 const dir=mkdtempSync(join(tmpdir(),'focus-codespaces-qa-'));
 const db=openDatabase(join(dir,'test.sqlite'));createOwner(db,credentials);
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw Error('Missing test server address');
 const internalHost=`127.0.0.1:${address.port}`,base=`http://${internalHost}`;
 async function request(method:string,path:string,body?:unknown,headers:Record<string,string>={}) {
  const payload=body===undefined?undefined:JSON.stringify(body);
  return new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;text:string;json:any}>((resolve,reject)=>{
   const req=httpRequest(base+path,{method,agent:false,headers:{Host:internalHost,'Content-Type':'application/json',...headers}},res=>{
    const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('error',reject);res.on('end',()=>{
     const text=Buffer.concat(chunks).toString('utf8');let json;try{json=JSON.parse(text);}catch{}
     resolve({status:res.statusCode!,headers:res.headers,text,json});
    });
   });req.on('error',reject);if(payload!==undefined)req.write(payload);req.end();
  });
 }
 async function close(){
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();rmSync(dir,{recursive:true,force:true});
  for(const [key,value] of [['FOCUS_PUBLIC_ORIGIN',previous.origin],['COOKIE_SECURE',previous.secure]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
 return {request,close,base};
}

test('Codespaces HTTPS Origin through internal Host: secure session and CSRF-protected mutations',async()=>{
 const f=await fixture(publicOrigin);try{
  assert.equal((await f.request('GET','/api/state')).status,401);
  const login=await f.request('POST','/api/session',credentials,{Origin:publicOrigin});assert.equal(login.status,200,login.text);
  const setCookie=login.headers['set-cookie']?.[0];assert.ok(setCookie);assert.match(setCookie,/;\s*Secure(?:;|$)/i);assert.match(setCookie,/;\s*HttpOnly(?:;|$)/i);assert.match(setCookie,/;\s*SameSite=Strict(?:;|$)/i);
  assert.equal(JSON.stringify(login.json).includes('password_hash'),false);
  const Cookie=setCookie.split(';')[0],csrf=login.json.csrfToken;assert.equal(typeof csrf,'string');
  const authorized={Origin:publicOrigin,Cookie,'X-CSRF-Token':csrf};
  const created=await f.request('POST','/api/tasks',{text:'Captura ficticia detrás de proxy',request_id:randomUUID()},authorized);assert.equal(created.status,201,created.text);assert.equal(created.json.tasks.length,1);
  for(const Origin of ['https://unrelated.example','http://fictional-focus-3000.app.github.dev','https://fictional-focus-3000.app.github.dev.evil.example',f.base]){
   const rejected=await f.request('POST','/api/tasks',{text:'No debe guardarse',request_id:randomUUID()},{...authorized,Origin,'X-Forwarded-Host':'fictional-focus-3000.app.github.dev','X-Forwarded-Proto':'https'});assert.equal(rejected.status,403);assert.equal(rejected.json.code,'ORIGIN');
  }
  const noCsrf=await f.request('POST','/api/tasks',{text:'Sin CSRF',request_id:randomUUID()},{Origin:publicOrigin,Cookie});assert.equal(noCsrf.status,403);assert.equal(noCsrf.json.code,'CSRF');
  const wrongCsrf=await f.request('POST','/api/tasks',{text:'CSRF incorrecto',request_id:randomUUID()},{...authorized,'X-CSRF-Token':'wrong'});assert.equal(wrongCsrf.status,403);assert.equal(wrongCsrf.json.code,'CSRF');
  const crossSite=await f.request('POST','/api/tasks',{text:'Cross-site',request_id:randomUUID()},{...authorized,'Sec-Fetch-Site':'cross-site'});assert.equal(crossSite.status,403);assert.equal(crossSite.json.code,'ORIGIN');
  const state=await f.request('GET','/api/state',undefined,{Cookie});assert.equal(state.status,200);assert.equal(state.json.tasks.length,1);
  const logout=await f.request('DELETE','/api/session',undefined,authorized);assert.equal(logout.status,200);assert.match(logout.headers['set-cookie']?.[0]??'',/;\s*Secure(?:;|$)/i);
  assert.equal((await f.request('GET','/api/state',undefined,{Cookie})).status,401);
 }finally{await f.close();}
});

test('Local fallback without public Origin still permits localhost login and rejects foreign origins',async()=>{
 const f=await fixture();try{
  const login=await f.request('POST','/api/session',credentials,{Origin:f.base});assert.equal(login.status,200,login.text);const cookie=login.headers['set-cookie']?.[0];assert.ok(cookie);assert.doesNotMatch(cookie,/;\s*Secure(?:;|$)/i);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  const authorized={Origin:f.base,Cookie:cookie.split(';')[0],'X-CSRF-Token':login.json.csrfToken};
  const created=await f.request('POST','/api/tasks',{text:'Captura local ficticia',request_id:randomUUID()},authorized);assert.equal(created.status,201,created.text);
  const foreign=await f.request('POST','/api/tasks',{text:'No autorizada',request_id:randomUUID()},{...authorized,Origin:publicOrigin});assert.equal(foreign.status,403);assert.equal(foreign.json.code,'ORIGIN');
  const withoutToken=await f.request('POST','/api/tasks',{text:'Sin token local',request_id:randomUUID()},{Origin:f.base,Cookie:authorized.Cookie});assert.equal(withoutToken.status,403);assert.equal(withoutToken.json.code,'CSRF');
 }finally{await f.close();}
});
