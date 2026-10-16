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
async function fixture(configuredOrigin?:string,rewrite=false) {
 const previous={origin:process.env.FOCUS_PUBLIC_ORIGIN,secure:process.env.COOKIE_SECURE,codespaces:process.env.CODESPACES,port:process.env.PORT};
 if(rewrite)process.env.CODESPACES='true';else delete process.env.CODESPACES;
 if(configuredOrigin===undefined)delete process.env.FOCUS_PUBLIC_ORIGIN;else process.env.FOCUS_PUBLIC_ORIGIN=configuredOrigin;
 process.env.COOKIE_SECURE=configuredOrigin?'true':'false';
 const dir=mkdtempSync(join(tmpdir(),'focus-codespaces-qa-'));
 const db=openDatabase(join(dir,'test.sqlite'));createOwner(db,credentials);
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw Error('Missing test server address');
 process.env.PORT=String(address.port);const rewriteHost=`localhost:${address.port}`;
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
  for(const [key,value] of [['FOCUS_PUBLIC_ORIGIN',previous.origin],['COOKIE_SECURE',previous.secure],['CODESPACES',previous.codespaces],['PORT',previous.port]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
 async function challenge(headers:Record<string,string>={}){const response=await request('GET','/api/session/challenge',undefined,headers);assert.equal(response.status,200,response.text);const cookie=response.headers['set-cookie']?.[0];assert.ok(cookie);assert.equal(typeof response.json.loginToken,'string');return {Cookie:cookie.split(';')[0],'X-Login-CSRF':response.json.loginToken};}
 return {request,close,base,rewriteHost,challenge};
}

test('Codespaces HTTPS Origin through internal Host: secure session and CSRF-protected mutations',async()=>{
 const f=await fixture(publicOrigin);try{
  assert.equal((await f.request('GET','/api/state')).status,401);
  const login=await f.request('POST','/api/session',credentials,{Origin:publicOrigin,...await f.challenge()});assert.equal(login.status,200,login.text);
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
  const login=await f.request('POST','/api/session',credentials,{Origin:f.base,...await f.challenge()});assert.equal(login.status,200,login.text);const cookie=login.headers['set-cookie']?.[0];assert.ok(cookie);assert.doesNotMatch(cookie,/;\s*Secure(?:;|$)/i);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  const authorized={Origin:f.base,Cookie:cookie.split(';')[0],'X-CSRF-Token':login.json.csrfToken};
  const created=await f.request('POST','/api/tasks',{text:'Captura local ficticia',request_id:randomUUID()},authorized);assert.equal(created.status,201,created.text);
  const foreign=await f.request('POST','/api/tasks',{text:'No autorizada',request_id:randomUUID()},{...authorized,Origin:publicOrigin});assert.equal(foreign.status,403);assert.equal(foreign.json.code,'ORIGIN');
  const withoutToken=await f.request('POST','/api/tasks',{text:'Sin token local',request_id:randomUUID()},{Origin:f.base,Cookie:authorized.Cookie});assert.equal(withoutToken.status,403);assert.equal(withoutToken.json.code,'CSRF');
 }finally{await f.close();}
});

test('Codespaces localhost proxy rewrite requires exact origin/host, Fetch metadata, challenge and session CSRF',async()=>{
 const f=await fixture(publicOrigin,true);try{
  const proxyHeaders={Origin:`http://${f.rewriteHost}`,Host:f.rewriteHost,'Sec-Fetch-Site':'same-origin'};
  const challenge=await f.challenge({Host:f.rewriteHost,'Sec-Fetch-Site':'same-origin'});
  assert.match(challenge.Cookie,/^__Host-focus_login_csrf=/);
  const login=await f.request('POST','/api/session',credentials,{...proxyHeaders,...challenge});assert.equal(login.status,200,login.text);
  const setCookie=login.headers['set-cookie']?.[0];assert.ok(setCookie);assert.match(setCookie,/;\s*Secure(?:;|$)/i);assert.match(setCookie,/;\s*HttpOnly(?:;|$)/i);assert.match(setCookie,/;\s*SameSite=Strict(?:;|$)/i);
  const authorized={...proxyHeaders,Cookie:setCookie.split(';')[0],'X-CSRF-Token':login.json.csrfToken};
  const task=await f.request('POST','/api/tasks',{text:'Tarea proxy reescrito ficticia',request_id:randomUUID()},authorized);assert.equal(task.status,201,task.text);
  const id=task.json.tasks[0].id;
  assert.equal((await f.request('PATCH',`/api/tasks/${id}`,{status:'completed'},authorized)).status,200);
  for(const overrides of [
   {Origin:'https://attacker.example'},
   {'Sec-Fetch-Site':'cross-site'},
   {'Sec-Fetch-Site':''},
   {Origin:'http://localhost:1'},
   {Origin:`http://127.0.0.1:${f.rewriteHost.split(':')[1]}`},
   {Host:'localhost:1'},
   {'Sec-Fetch-Mode':'navigate'},
   {'Sec-Fetch-Dest':'document'},
  ] as Record<string,string>[]){
   const response=await f.request('POST','/api/tasks',{text:'No autorizada',request_id:randomUUID()},{...authorized,...overrides});assert.equal(response.status,403,JSON.stringify(overrides));assert.equal(response.json.code,'ORIGIN');
  }
  for(const mode of ['cors','same-origin'])assert.equal((await f.request('PATCH',`/api/tasks/${id}`,{priority:'high'},{...authorized,'Sec-Fetch-Mode':mode,'Sec-Fetch-Dest':'empty'})).status,200);
  const {['Sec-Fetch-Site']:omitted,...withoutFetchSite}=authorized;assert.equal((await f.request('POST','/api/tasks',{text:'Sin metadata',request_id:randomUUID()},withoutFetchSite)).status,403);
  delete process.env.CODESPACES;assert.equal((await f.request('POST','/api/tasks',{text:'Excepción desactivada',request_id:randomUUID()},authorized)).status,403);process.env.CODESPACES='true';
  const noCsrf=await f.request('PATCH',`/api/tasks/${id}`,{title:'No autorizado'},{...authorized,'X-CSRF-Token':''});assert.equal(noCsrf.status,403);assert.equal(noCsrf.json.code,'CSRF');
  const logout=await f.request('DELETE','/api/session',undefined,authorized);assert.equal(logout.status,200);assert.equal((await f.request('GET','/api/state',undefined,{Cookie:authorized.Cookie})).status,401);
 }finally{await f.close();}
});

test('login challenge rejects missing, wrong, forged and replayed tokens before establishing a session',async()=>{
 const f=await fixture(publicOrigin,true);try{
  const proxy={Origin:`http://${f.rewriteHost}`,Host:f.rewriteHost,'Sec-Fetch-Site':'same-origin'};
  for(const headers of [proxy,{...proxy,Cookie:'__Host-focus_login_csrf=forged','X-Login-CSRF':'forged'}]){
   const response=await f.request('POST','/api/session',credentials,headers);assert.equal(response.status,403,response.text);
  }
  const wrong=await f.challenge(proxy);assert.equal((await f.request('POST','/api/session',credentials,{...proxy,...wrong,'X-Login-CSRF':'wrong-token'})).status,403);
  const missingCookie=await f.challenge(proxy);assert.equal((await f.request('POST','/api/session',credentials,{...proxy,'X-Login-CSRF':missingCookie['X-Login-CSRF']})).status,403);
  const valid=await f.challenge(proxy);assert.equal((await f.request('POST','/api/session',credentials,{...proxy,...valid})).status,200);assert.equal((await f.request('POST','/api/session',credentials,{...proxy,...valid})).status,403);
  const failedPassword=await f.challenge(proxy);assert.equal((await f.request('POST','/api/session',{...credentials,password:'Incorrect-fictional-password'},{...proxy,...failedPassword})).status,401);assert.equal((await f.request('POST','/api/session',credentials,{...proxy,...failedPassword})).status,403);
 }finally{await f.close();}
});

test('login challenge expires after ten minutes and rejects duplicate challenge cookies',async()=>{
 const f=await fixture(publicOrigin,true);const originalNow=Date.now;try{
  const proxy={Origin:`http://${f.rewriteHost}`,Host:f.rewriteHost,'Sec-Fetch-Site':'same-origin'};
  const expired=await f.challenge(proxy);const issuedAt=originalNow();Date.now=()=>issuedAt+10*60*1000;
  const timeout=await f.request('POST','/api/session',credentials,{...proxy,...expired});assert.equal(timeout.status,403);assert.equal(timeout.json.code,'LOGIN_CSRF');
  Date.now=originalNow;
  assert.equal((await f.request('POST','/api/session',credentials,{...proxy,...expired})).status,403,'Expired tokens cannot revive when the clock returns');
  const duplicate=await f.challenge(proxy);
  const duplicatedCookie=await f.request('POST','/api/session',credentials,{...proxy,...duplicate,Cookie:`${duplicate.Cookie}; ${duplicate.Cookie}`});assert.equal(duplicatedCookie.status,403);assert.equal(duplicatedCookie.json.code,'LOGIN_CSRF');
  const conflictingCookie=await f.request('POST','/api/session',credentials,{...proxy,...duplicate,Cookie:`${duplicate.Cookie}; __Host-focus_login_csrf=${'f'.repeat(64)}`});assert.equal(conflictingCookie.status,403);
  const valid=await f.request('POST','/api/session',credentials,{...proxy,...duplicate});assert.equal(valid.status,200,valid.text);
 }finally{Date.now=originalNow;await f.close();}
});
