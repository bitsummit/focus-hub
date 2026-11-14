import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createTestDatabase} from './postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';

const root=resolve('.'),loader=join(root,'node_modules/tsx/dist/loader.mjs');
const nodeArgs=['--no-experimental-sqlite','--import',loader];
function environment(extra:NodeJS.ProcessEnv={}){
 const env={...process.env,...extra};
 for(const key of ['DATABASE_URL','DATABASE_SCHEMA','FOCUS_DB','FOCUS_PUBLIC_ORIGIN','CODESPACES','COOKIE_SECURE','FOCUS_DEV','FOCUS_DEMO'])if(!(key in extra))delete env[key];
 return env;
}
async function port(){const server=createServer().listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');await new Promise<void>(done=>server.close(()=>done()));return address.port;}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await done;}finally{clearTimeout(timer);}}

for(const entry of ['server/index.ts','server/dev.ts','server/demo.ts'])test(`${entry}: missing or unreachable PostgreSQL fails with SQLite disabled and preserves legacy files`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-pg-only-failure-'));
 const legacy=join(dir,'.data','demo.sqlite'),sentinel='fictional old database sentinel';mkdirSync(join(dir,'.data'));writeFileSync(legacy,sentinel);
 const closedPort=await port();
 try{
  const unavailable=`postgresql://fictional:unused@127.0.0.1:${closedPort}/unavailable`;
  const configurations:NodeJS.ProcessEnv[]=[{}, {DATABASE_URL:unavailable}, {DATABASE_URL:'sqlite://legacy.sqlite'}, {DATABASE_URL:unavailable,FOCUS_DB:legacy}, {DATABASE_URL:unavailable,NODE_ENV:'production',FOCUS_DEMO:'true'}];
  for(const configuration of configurations){
   const env=environment({NODE_ENV:entry==='server/dev.ts'?'development':'production',...configuration});
   const result=spawnSync(process.execPath,[...nodeArgs,join(root,entry)],{cwd:dir,env,encoding:'utf8',timeout:15000});
   assert.equal(result.status,1,'startup must exit unsuccessfully');assert.match(result.stderr,/PostgreSQL|DATABASE_URL/);
   assert.doesNotMatch(result.stderr,/ERR_UNKNOWN_BUILTIN_MODULE|node:sqlite|fictional:unused/);
   assert.equal(readFileSync(legacy,'utf8'),sentinel);assert.deepEqual(readdirSync(join(dir,'.data')),['demo.sqlite']);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('development and compiled production run and restart on PostgreSQL with node:sqlite disabled',async()=>{
 const fixture=await createTestDatabase(),email='postgres-only@example.test',password=randomBytes(24).toString('base64url');
 await createOwner(fixture.db,{email,password,display_name:'Fictional PG-only validation'});
 const serverPort=await port(),base=`http://127.0.0.1:${serverPort}`;let taskId='';
 try{
  for(const entry of ['server/dev.ts','server/index.ts']){
   let cookie='',csrf='';
   for(let restart=0;restart<2;restart++){
    const child=spawn(process.execPath,[...nodeArgs,join(root,entry)],{cwd:root,env:environment({DATABASE_URL:fixture.url,DATABASE_SCHEMA:fixture.schema,PORT:String(serverPort),NODE_ENV:entry==='server/dev.ts'?'development':'production'}),stdio:['ignore','pipe','pipe']});
    let logs='';child.stdout!.on('data',data=>{logs+=data;});child.stderr!.on('data',data=>{logs+=data;});
    try{
     let ready=false;
     for(let i=0;i<150&&!ready;i++){
      assert.equal(child.exitCode,null,'own PostgreSQL server exited unexpectedly');
      try{ready=(await fetch(base+'/api/health',{signal:AbortSignal.timeout(300)})).status===200;}catch{}
      if(!ready)await new Promise(done=>setTimeout(done,50));
     }
     assert.ok(ready,'PostgreSQL-only server must become ready');
     assert.doesNotMatch(logs,/node:sqlite|ERR_UNKNOWN_BUILTIN_MODULE/);
     if(!restart){
      const challenge=await fetch(base+'/api/session/challenge');const token=await challenge.json();
      const login=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Cookie:challenge.headers.get('set-cookie')!.split(';')[0],'X-Login-CSRF':token.loginToken},body:JSON.stringify({email,password})});assert.equal(login.status,200);
      cookie=login.headers.get('set-cookie')!.split(';')[0];csrf=(await login.json()).csrfToken;
      if(!taskId){const created=await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({text:'Fictional PostgreSQL-only task',request_id:randomUUID()})});assert.equal(created.status,201);taskId=(await created.json()).tasks[0].id;}
     }
     const state=await fetch(base+'/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);assert.ok((await state.json()).tasks.some((task:{id:string})=>task.id===taskId));
     const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(await html.text(),/<div id="root">/);
    }finally{await stop(child);}
   }
  }
 }finally{await fixture.close();}
});

test('demo and PostgreSQL backup/verify/restore do not load SQLite at all',async()=>{
 const source=await createTestDatabase(),restored=await createTestDatabase(),dir=mkdtempSync(join(tmpdir(),'focus-pg-only-tools-'));
 function run(script:string,args:string[],fixture=source){const result=spawnSync(process.execPath,[...nodeArgs,join(root,script),...args],{cwd:dir,env:environment({DATABASE_URL:fixture.url,DATABASE_SCHEMA:fixture.schema}),encoding:'utf8',timeout:20000});assert.equal(result.status,0,`PostgreSQL tool failed: ${script}`);assert.doesNotMatch(result.stderr,/node:sqlite|ERR_UNKNOWN_BUILTIN_MODULE/);return result.stdout;}
 try{
  run('server/demo.ts',[]);assert.equal(Number((await source.db.one('SELECT count(*)::integer n FROM tasks'))!.n),4);
  const backup=join(dir,'private-backup.json');run('scripts/postgres-database.ts',['backup','--out',backup]);run('scripts/postgres-database.ts',['verify','--source',backup]);run('scripts/postgres-database.ts',['restore','--source',backup],restored);
  assert.equal(Number((await restored.db.one('SELECT count(*)::integer n FROM tasks'))!.n),4);
  assert.ok(!readdirSync(join(dir,'.data')).some(name=>/\.(sqlite|db)(-|$)/.test(name)));
 }finally{await source.close();await restored.close();rmSync(dir,{recursive:true,force:true});}
});


test('production launch helpers require an explicit PostgreSQL URL and reject demo mode before local setup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-production-guard-'));
 try{
  for(const script of ['scripts/dev-postgres.mjs','.devcontainer/postgres.mjs']){
   const args=script.startsWith('scripts/')?['run',process.execPath,'-e','process.exit(99)']:['start'];
   for(const extra of [{NODE_ENV:'production'},{NODE_ENV:'production',FOCUS_DEMO:'true',DATABASE_URL:'postgresql://fictional:unused@127.0.0.1:1/unavailable'}]){
    const result=spawnSync(process.execPath,[...nodeArgs,join(root,script),...args],{cwd:dir,env:environment(extra),encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);assert.match(result.stderr,/Producción/);assert.doesNotMatch(result.stderr,/Docker|node:sqlite|fictional:unused/);
   }
  }
  assert.deepEqual(readdirSync(dir),[],'no fallback setup files may be created');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
