import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {mkdtempSync,rmSync,statSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {openDatabase} from '../server/db.ts';
import {createApp} from '../server/app.ts';
import {createOwner,changePassword,verifyPassword,verifyPasswordAsync} from '../server/auth.ts';
import {resolveRuntime} from '../server/runtime.ts';

const password='Fictional-Hardening-2026!';
const email='hardening-a@example.test';
async function fixture(secure=false){
 const keys=['FOCUS_PUBLIC_ORIGIN','COOKIE_SECURE','CODESPACES'] as const;
 const previous=keys.map(key=>[key,process.env[key]] as const);
 delete process.env.CODESPACES;delete process.env.FOCUS_PUBLIC_ORIGIN;process.env.COOKIE_SECURE=String(secure);
 const dir=mkdtempSync(join(tmpdir(),'focus-security-'));
 const db=openDatabase(join(dir,'fixture.sqlite'));
 createOwner(db,{email,password});createOwner(db,{email:'hardening-b@example.test',password});
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}`,origin=secure?'https://security.example.test':base;
 if(secure)process.env.FOCUS_PUBLIC_ORIGIN=origin;
 async function request(method:string,path:string,data?:unknown,headers:Record<string,string>={},raw=false){
  return new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;text:string;json:any}>((resolve,reject)=>{
   const req=httpRequest(base+path,{method,agent:false,headers:{'Content-Type':'application/json',Origin:origin,...headers}},response=>{
    const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(Buffer.from(chunk)));response.on('error',reject);response.on('end',()=>{
     const text=Buffer.concat(chunks).toString();let json;try{json=JSON.parse(text);}catch{}
     resolve({status:response.statusCode!,headers:response.headers,text,json});
    });
   });req.on('error',reject);if(data!==undefined)req.write(raw?String(data):JSON.stringify(data));req.end();
  });
 }
 async function login(loginEmail=email,loginPassword=password){
  const challenge=await request('GET','/api/session/challenge');assert.equal(challenge.status,200);
  const cookie=challenge.headers['set-cookie']?.[0];assert.ok(cookie);
  return request('POST','/api/session',{email:loginEmail,password:loginPassword},{Cookie:cookie.split(';')[0],'X-Login-CSRF':challenge.json.loginToken});
 }
 function credentials(response:Awaited<ReturnType<typeof request>>){assert.equal(response.status,200,response.text);const cookie=response.headers['set-cookie']?.[0];assert.ok(cookie);return {Cookie:cookie.split(';')[0],'X-CSRF-Token':String(response.json.csrfToken)};}
 async function close(){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();rmSync(dir,{recursive:true,force:true});for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 return {db,request,login,credentials,close};
}

test('HTTPS session cookies are host-prefixed and secure, duplicate/legacy cookies cannot override identity',async()=>{
 const f=await fixture(true);try{
  const login=await f.login(),headers=f.credentials(login),cookie=login.headers['set-cookie']![0];
  assert.match(cookie,/^__Host-focus_session=/);assert.match(cookie,/;\s*Secure(?:;|$)/i);assert.match(cookie,/;\s*HttpOnly(?:;|$)/i);assert.match(cookie,/;\s*SameSite=Strict(?:;|$)/i);assert.match(cookie,/;\s*Path=\/(?:;|$)/i);assert.match(cookie,/;\s*Max-Age=604800(?:;|$)/i);assert.doesNotMatch(cookie,/;\s*Domain=/i);
  assert.equal((await f.request('GET','/api/state',undefined,headers)).status,200);
  const duplicate={...headers,Cookie:`${headers.Cookie}; ${headers.Cookie}`};
  assert.equal((await f.request('GET','/api/session',undefined,duplicate)).status,401);
  assert.equal((await f.request('GET','/api/state',undefined,duplicate)).status,401);
  assert.equal((await f.request('GET','/api/state',undefined,{Cookie:headers.Cookie.replace('__Host-focus_session=','focus_session=')})).status,401);
  const token=headers.Cookie.split('=')[1];assert.equal(Number((f.db.prepare('SELECT count(*) AS n FROM sessions WHERE id_hash=?').get(token) as {n:number}).n),0,'raw bearer token is not persisted');
  const logout=await f.request('DELETE','/api/session',undefined,headers);assert.equal(logout.status,200);assert.match(logout.headers['set-cookie']?.[0]||'',/^__Host-focus_session=/);
  assert.equal((await f.request('GET','/api/state',undefined,headers)).status,401);
 }finally{await f.close();}
});

test('HTTPS and Codespaces cannot downgrade secure cookies through COOKIE_SECURE=false',()=>{
 assert.equal(resolveRuntime({FOCUS_PUBLIC_ORIGIN:'https://security.example.test',COOKIE_SECURE:'false'}).secure,true);
 assert.equal(resolveRuntime({CODESPACES:'true',FOCUS_PUBLIC_ORIGIN:'https://security.example.test',COOKIE_SECURE:'false'}).secure,true);
 assert.equal(resolveRuntime({FOCUS_PUBLIC_ORIGIN:'http://localhost:3000',COOKIE_SECURE:'false'}).secure,false);
});

test('session expiry and cross-site requests reject access without changing stored tasks',async()=>{
 const f=await fixture();try{
  const headers=f.credentials(await f.login());assert.match(headers.Cookie,/^focus_session=/);
  const rejected=await f.request('POST','/api/tasks',{text:'Must never be stored',request_id:randomUUID()},{...headers,Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site'});assert.equal(rejected.status,403);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM tasks').get() as {n:number}).n,0);
  f.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
  for(const path of ['/api/session','/api/state','/api/export?format=json'])assert.equal((await f.request('GET',path,undefined,headers)).status,401);
 }finally{await f.close();}
});

test('password rotation rejects weak values, preserves data and revokes every owner session only',async()=>{
 const f=await fixture();try{
  const a=f.credentials(await f.login()),aSecond=f.credentials(await f.login()),b=f.credentials(await f.login('hardening-b@example.test'));
  const created=await f.request('POST','/api/tasks',{text:'Preserved fictional task',request_id:randomUUID()},a);assert.equal(created.status,201);
  const oldHash=(f.db.prepare('SELECT password_hash FROM users WHERE email=?').get(email) as {password_hash:string}).password_hash;
  for(const weak of ['123456','x'.repeat(257)])assert.throws(()=>changePassword(f.db,{email,password:weak}));
  assert.equal((await f.request('GET','/api/state',undefined,a)).status,200);
  const replacement='Rotated-Fictional-2026!';
  f.db.exec("CREATE TRIGGER fixture_revoke_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'Fictional revocation failure'); END");
  assert.throws(()=>changePassword(f.db,{email,password:replacement}));
  assert.equal((f.db.prepare('SELECT password_hash FROM users WHERE email=?').get(email) as {password_hash:string}).password_hash,oldHash,'a revocation failure rolls back the password update');
  assert.equal((await f.request('GET','/api/state',undefined,a)).status,200);
  f.db.exec('DROP TRIGGER fixture_revoke_failure');
  changePassword(f.db,{email,password:replacement});
  const newHash=(f.db.prepare('SELECT password_hash FROM users WHERE email=?').get(email) as {password_hash:string}).password_hash;
  assert.notEqual(newHash,oldHash);assert.ok(verifyPassword(replacement,newHash));assert.equal(verifyPassword(password,newHash),false);
  for(const credentials of [a,aSecond])assert.equal((await f.request('GET','/api/state',undefined,credentials)).status,401);
  assert.equal((await f.request('GET','/api/state',undefined,b)).status,200);
  assert.equal((await f.login(email,password)).status,401);
  const fresh=f.credentials(await f.login(email,replacement));const state=await f.request('GET','/api/state',undefined,fresh);assert.equal(state.status,200);assert.equal(state.json.tasks[0].id,created.json.tasks[0].id);
 }finally{await f.close();}
});

test('login account budget survives successful logins and normalization, returns Retry-After and expires',async()=>{
 const f=await fixture(),originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
 try{
  for(let i=0;i<5;i++)assert.equal((await f.login(' HARDENING-A@EXAMPLE.TEST ','Incorrect-fictional-password')).status,401);
  assert.equal((await f.login()).status,200);
  for(let i=0;i<4;i++)assert.equal((await f.login(email,'Incorrect-fictional-password')).status,401);
  const limited=await f.login();assert.equal(limited.status,429);assert.ok(Number(limited.headers['retry-after'])>0);assert.ok(Number(limited.headers['retry-after'])<=900);
  assert.equal((await f.login('hardening-b@example.test')).status,200,'a separate account is not locked by account A budget');
  clock+=15*60*1000+1;assert.equal((await f.login()).status,200);
 }finally{Date.now=originalNow;await f.close();}
});

test('JSON and validation errors do not echo submitted private strings',async()=>{
 const f=await fixture();try{
  const marker='Fictional-private-marker-should-not-appear';
  const malformed=await f.request('POST','/api/session',`{"password":"${marker}",`,{},true);assert.equal(malformed.status,400);assert.equal(malformed.text.includes(marker),false);
  const headers=f.credentials(await f.login());
  const invalid=await f.request('PATCH','/api/preferences',{theme:marker},headers);assert.equal(invalid.status,400);assert.equal(invalid.text.includes(marker),false);
 }finally{await f.close();}
});

import {loginLimiter} from '../server/login-limiter.ts';
test('login source budget and bounded storage reject atomically and recover after expiry',()=>{
 const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
 try{
  const budget=loginLimiter();
  for(let i=0;i<100;i++)assert.equal(budget.consume(`fictional-${i}@example.test`,'shared-proxy'),0);
  const blocked=budget.consume('fresh@example.test','shared-proxy');assert.ok(blocked>0&&blocked<=60);
  clock+=60001;
  for(let i=0;i<10;i++)assert.equal(budget.consume('fresh@example.test','shared-proxy'),0,'a source-limited rejection must not consume the account budget');
  assert.ok(budget.consume('fresh@example.test','shared-proxy')>0);
  const bounded=loginLimiter();
  for(let i=0;i<1000;i++)assert.equal(bounded.consume(`bounded-${i}@example.test`,`fictional-source-${i}`),0);
  assert.ok(bounded.consume('overflow@example.test','overflow-source')>0,'full limiter maps fail closed');
  assert.ok(bounded.consume('bounded-0@example.test','overflow-source')>0,'a full source map cannot evict previous protection');
  clock+=15*60*1000+1;
  assert.equal(bounded.consume('overflow@example.test','overflow-source'),0,'expired map entries are pruned');
 }finally{Date.now=originalNow;}
});


test('API rejects DNS-rebinding Hosts and noncanonical Origins while trusted local/public Hosts work',async()=>{
 for(const secure of [false,true]){
  const f=await fixture(secure);try{
   assert.equal((await f.request('GET','/api/health')).status,200);
   for(const headers of [
    {Host:'attacker.example',Origin:'http://attacker.example'},
    {Host:'attacker.example',Origin:''},
    {Origin:'https://user:password@security.example.test'},
    {Origin:'https://security.example.test/private'},
    {Origin:'null'},
   ] as Record<string,string>[])assert.equal((await f.request('GET','/api/health',undefined,headers)).status,403,JSON.stringify(headers));
   if(secure)assert.equal((await f.request('GET','/api/health',undefined,{Host:'security.example.test'})).status,200);
  }finally{await f.close();}
 }
});

test('SQLite database and WAL sidecars are private and existing loose database permissions are repaired',()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-db-permissions-')),path=join(dir,'fixture.sqlite');
 let db:ReturnType<typeof openDatabase>|undefined;
 try{
  db=openDatabase(path);createOwner(db,{email:'permissions@example.test',password});
  for(const file of [path,path+'-wal',path+'-shm']){
   assert.ok(existsSync(file),'WAL fixture must exist before checking permissions');
   assert.equal(statSync(file).mode&0o777,0o600,file);
  }
  db.close();db=undefined;chmodSync(path,0o644);
  db=openDatabase(path);
  assert.equal(statSync(path).mode&0o777,0o600,'existing broad DB permissions are tightened');
  for(const suffix of ['-wal','-shm'])if(existsSync(path+suffix))assert.equal(statSync(path+suffix).mode&0o777,0o600);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});


test('modern password hashes use versioned scrypt parameters and preserve legacy verification compatibility',async()=>{
 const f=await fixture();try{
  const stored=()=>String((f.db.prepare('SELECT password_hash FROM users WHERE email=?').get(email) as {password_hash:string}).password_hash);
  const modern=stored();
  assert.match(modern,/^scrypt-v2:32768:8:3:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(verifyPassword(password,modern),true);
  assert.equal(await verifyPasswordAsync(password,modern),true);
  assert.equal(await verifyPasswordAsync('Incorrect-fictional-password',modern),false);
  const salt='a'.repeat(32),legacy=salt+':'+scryptSync(password,salt,64).toString('hex');
  assert.equal(verifyPassword(password,legacy),true);
  assert.equal(await verifyPasswordAsync(password,legacy),true);
  assert.equal(verifyPassword('Incorrect-fictional-password',legacy),false);
  for(const invalid of ['', 'not-a-hash', 'a:ff', 'scrypt-v2:2147483648:8:3:'+salt+':'+('f'.repeat(128)), 'scrypt-v2:32768:8:3:'+salt+':zz']){
   assert.equal(verifyPassword(password,invalid),false);
   assert.equal(await verifyPasswordAsync(password,invalid),false);
  }
  changePassword(f.db,{email,password:'Modern-rotation-fictional-2026!'});
  assert.match(stored(),/^scrypt-v2:32768:8:3:[a-f0-9]{32}:[a-f0-9]{128}$/);
 }finally{await f.close();}
});

test('asynchronous password verification bounds KDF concurrency and keeps event loop responsive',async()=>{
 const f=await fixture();try{
  const stored=String((f.db.prepare('SELECT password_hash FROM users WHERE email=?').get(email) as {password_hash:string}).password_hash);
  let completed=false,timerBeforeCompletion=false;
  const timer=new Promise<void>(resolve=>setTimeout(()=>{timerBeforeCompletion=!completed;resolve();},0));
  const first=verifyPasswordAsync(password,stored),second=verifyPasswordAsync(password,stored);
  const rejected=assert.rejects(verifyPasswordAsync(password,stored),(error:unknown)=>{
   const busy=error as {status?:number;code?:string};return busy.status===503&&busy.code==='AUTH_BUSY';
  });
  try{
   const verified=Promise.all([first,second]).then(values=>{completed=true;return values;});
   const [values]=await Promise.all([verified,rejected,timer]);
   assert.deepEqual(values,[true,true]);
   assert.equal(timerBeforeCompletion,true,'a timer runs while the worker pool derives passwords');
  }finally{await Promise.allSettled([first,second,rejected,timer]);}
  assert.equal(await verifyPasswordAsync(password,stored),true,'completed operations release their concurrency slots');
 }finally{await f.close();}
});

test('password rotation during asynchronous login cannot recreate a revoked session',async()=>{
 const f=await fixture(),prepare=f.db.prepare;
 let intercepted=false,rotationCompleted=false,rotationError:unknown;
 const replacement='Concurrent-rotation-fictional-2026!';
 try{
  const previous=f.credentials(await f.login());
  f.db.prepare=function(sql:string){
   const statement=prepare.call(this,sql);
   if(sql!=='SELECT * FROM users WHERE email=? COLLATE NOCASE'||intercepted)return statement;
   return new Proxy(statement,{
    get(target,key){
     if(key==='get')return (...bindings:import('node:sqlite').SQLInputValue[])=>{
      const row=target.get(...bindings);intercepted=true;
      queueMicrotask(()=>{
       try{changePassword(f.db,{email,password:replacement});rotationCompleted=true;}
       catch(error){rotationError=error;}
      });
      return row;
     };
     const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },
   });
  };
  const stale=await f.login();
  assert.equal(intercepted,true);assert.equal(rotationError,undefined);assert.equal(rotationCompleted,true);
  assert.equal(stale.status,401,'a login verified against the previous hash cannot issue a session after rotation');
  assert.equal((prepare.call(f.db,'SELECT count(*) AS n FROM sessions').get() as {n:number}).n,0);
  assert.equal((await f.request('GET','/api/state',undefined,previous)).status,401);
  f.db.prepare=prepare;
  assert.equal((await f.login(email,replacement)).status,200);
 }finally{f.db.prepare=prepare;await f.close();}
});
