import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync,symlinkSync,existsSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {Client} from 'pg';
import {openDatabase} from '../server/db.ts';
import {createTestDatabase} from './postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';
import {RECOVERY_TABLES} from '../server/data-tables.ts';
import {backupPostgres} from '../server/postgres-recovery.ts';
import {adoptLocalPostgres,readActivePostgresBinding,validateAdoptedTarget} from '../server/local-adoption.ts';

async function fixture(){
 const database=await createTestDatabase(),dir=mkdtempSync(join(tmpdir(),'focus-adoption-'));
 const user=await createOwner(database.db,{email:'adoption@example.test',password:randomBytes(24).toString('base64url'),display_name:'Fictional local adoption'});
 const workspace=String((await database.db.one('SELECT id FROM workspaces'))!.id),domain=new Domain(database.db,{user_id:user.id,workspace_id:workspace});
 await domain.capture({text:'Fictional preserved task',request_id:randomUUID(),journal_date:'2026-11-14'});
 const backup=join(dir,'backup.json');await backupPostgres(database.db,backup);
 const expectedRole=String((await database.db.one('SELECT current_user AS name'))!.name);
 return {...database,dir,domain,backup,expectedRole,bindingPath:join(dir,'.data','active-postgres.json'),async close(){await database.close();rmSync(dir,{recursive:true,force:true});}};
}
test('local adoption validates backup fidelity and publishes only a private identity binding, preserving old files and all records',async()=>{
 const f=await fixture();
 try{
  mkdirSync(join(f.dir,'.data'),{mode:0o700});
  const access=join(f.dir,'.data','demo-access.json'),legacy=join(f.dir,'.data','demo.sqlite');writeFileSync(access,'{"database":".data/demo.sqlite","notice":"fictional legacy metadata"}');writeFileSync(legacy,'fictional preserved SQLite sentinel');
  const oldAccess=readFileSync(access),oldLegacy=readFileSync(legacy),beforeBackup=readFileSync(f.backup);
  const before=Object.fromEntries(await Promise.all(RECOVERY_TABLES.map(async table=>[table,await f.db.all(`SELECT * FROM ${table}`)])));
  const binding=await adoptLocalPostgres(f.db,{kind:'demo',expectedRole:f.expectedRole,backupPath:f.backup,bindingPath:f.bindingPath});
  assert.equal(binding.identity,f.db.identity);assert.equal(statSync(f.bindingPath).mode&0o777,0o600);assert.equal(statSync(join(f.dir,'.data')).mode&0o777,0o700);
  assert.deepEqual(Object.keys(binding).sort(),['backupSha256','identity','kind','version']);assert.deepEqual(readActivePostgresBinding(f.bindingPath),binding);
  const bindingBytes=readFileSync(f.bindingPath);await adoptLocalPostgres(f.db,{kind:'demo',expectedRole:f.expectedRole,backupPath:f.backup,bindingPath:f.bindingPath});assert.deepEqual(readFileSync(f.bindingPath),bindingBytes);
  for(const table of RECOVERY_TABLES)assert.deepEqual(await f.db.all(`SELECT * FROM ${table}`),before[table]);
  assert.deepEqual(readFileSync(access),oldAccess);assert.deepEqual(readFileSync(legacy),oldLegacy);assert.deepEqual(readFileSync(f.backup),beforeBackup);
  await assert.rejects(adoptLocalPostgres(f.db,{kind:'dev',expectedRole:f.expectedRole,backupPath:f.backup,bindingPath:f.bindingPath}),/otro destino/);
 }finally{await f.close();}
});
test('local adoption rejects stale backups, different role identities and backups without a valid owner/workspace',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(validateAdoptedTarget(f.db,'unexpected_local_role'),/cuenta PostgreSQL dedicada/);
  await assert.rejects(adoptLocalPostgres(f.db,{kind:'demo',expectedRole:f.expectedRole,backupPath:f.backup,bindingPath:f.bindingPath,expectedBackupSha256:'a'.repeat(64)}),/después del ensayo/);
  await f.domain.capture({text:'Fictional work after backup',request_id:randomUUID()});
  await assert.rejects(adoptLocalPostgres(f.db,{kind:'demo',expectedRole:f.expectedRole,backupPath:f.backup,bindingPath:f.bindingPath}),/no coinciden/);assert.equal(existsSync(f.bindingPath),false);
  const empty=await createTestDatabase();try{await assert.rejects(validateAdoptedTarget(empty.db,f.expectedRole),/cuenta y workspace/);}finally{await empty.close();}
 }finally{await f.close();}
});
test('local adoption binding rejects symlinks, broad permissions, unknown fields and malformed JSON without revealing input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-adoption-binding-')),path=join(dir,'active.json');
 try{
  assert.equal(readActivePostgresBinding(path),undefined);
  const sensitiveSentinel='FICTIONAL_SENSITIVE_SENTINEL';writeFileSync(path,'{'+sensitiveSentinel,{mode:0o600});
  assert.throws(()=>readActivePostgresBinding(path),error=>error instanceof Error&&!error.message.includes(sensitiveSentinel)&&/sin mostrar/.test(error.message));
  writeFileSync(path,JSON.stringify({version:1,kind:'demo',identity:'pg:'+'a'.repeat(64),backupSha256:'b'.repeat(64),url:'not allowed'}));assert.throws(()=>readActivePostgresBinding(path),/no es válida/);
  const link=join(dir,'link.json');symlinkSync(path,link);assert.throws(()=>readActivePostgresBinding(link));
  const broad=join(dir,'broad.json');writeFileSync(broad,'{}',{mode:0o644});assert.throws(()=>readActivePostgresBinding(broad));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('local adoption CLI rejects external or production selection before opening databases or generating local files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-adoption-cli-'));
 try{
  for(const change of [{DATABASE_URL:'postgresql://fictional:unused@127.0.0.1:1/unused'},{NODE_ENV:'production'}]){
   const env:NodeJS.ProcessEnv={...process.env,...change};delete env.FOCUS_DB;delete env.DATABASE_SCHEMA;
   const result=spawnSync(process.execPath,['--import',new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).pathname,new URL('../scripts/adopt-local-postgres.ts',import.meta.url).pathname,'--database','demo','--backup','unused.json'],{cwd:dir,env,encoding:'utf8',timeout:15000});
   assert.equal(result.status,1);assert.match(result.stderr,/adopción es solo local/);assert.doesNotMatch(result.stderr,/fictional:unused/);
  }
  assert.equal(existsSync(join(dir,'.data')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('adopted local database survives real managed setup/start/repeated start and restart with legacy metadata intact',async()=>{
 const tools=await import(new URL('../scripts/dev-postgres.mjs',import.meta.url).href),local=tools.readLocalPostgres();
 const admin=new Client({host:'127.0.0.1',port:local.port,user:'focus',password:local.password,database:'postgres',connectionTimeoutMillis:5000});
 const name=`focus_adopt_${randomUUID().replaceAll('-','')}`,dir=mkdtempSync(join(tmpdir(),'focus-adoption-managed-'));
 const loader=new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).pathname;
 const reserve=createServer().listen(0,'127.0.0.1');await once(reserve,'listening');const address=reserve.address();assert.ok(address&&typeof address!=='string');const port=address.port;await new Promise<void>(done=>reserve.close(()=>done()));
 let created=false,db:Awaited<ReturnType<typeof openDatabase>>|undefined;
 const target=new URL(local.demoDatabaseUrl);target.pathname='/'+name;
 const env:NodeJS.ProcessEnv={...process.env,FOCUS_TEST_LOCAL_URL:target.toString(),NODE_ENV:'development',FOCUS_DEV:'false',PORT:String(port),CODESPACES:'false',COOKIE_SECURE:'false'};delete env.DATABASE_URL;delete env.DATABASE_SCHEMA;delete env.FOCUS_DB;delete env.FOCUS_PUBLIC_ORIGIN;delete env.FOCUS_DEMO;
 function command(script:string,args:string[]){const result=spawnSync(process.execPath,['--import',loader,join(dir,script),...args],{cwd:dir,env,encoding:'utf8',timeout:30000});const log=join(dir,'.data','codespaces-server.log');assert.equal(result.status,0,`Own fixture command failed: ${script} ${args.join(' ')}: ${result.stderr} ${result.stdout} ${existsSync(log)?readFileSync(log,'utf8'):''}`);return result.stdout;}
 try{
  await admin.connect();assert.match(name,/^focus_adopt_[a-f0-9]{32}$/);
  await admin.query(`CREATE DATABASE ${name} OWNER focus_demo_runtime`);created=true;
  await admin.query(`REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${name} TO focus_demo_runtime`);
  for(const source of ['server','migrations','shared'])cpSync(new URL('../'+source,import.meta.url),join(dir,source),{recursive:true});
  mkdirSync(join(dir,'.devcontainer'));for(const file of ['postgres.mjs','service.mjs'])cpSync(new URL('../.devcontainer/'+file,import.meta.url),join(dir,'.devcontainer',file));
  mkdirSync(join(dir,'scripts'));cpSync(new URL('../scripts/adopt-local-postgres.ts',import.meta.url),join(dir,'scripts','adopt-local-postgres.ts'));
  // Fixture selector only: all database/domain/auth/rehearsal/service code is real.
  writeFileSync(join(dir,'scripts','dev-postgres.mjs'),"export function readLocalPostgres(){return {ready:process.env.FOCUS_TEST_READY!=='false',accountsReady:process.env.FOCUS_TEST_ACCOUNT_READY!=='false',demoDatabaseUrl:process.env.FOCUS_TEST_LOCAL_URL,developmentUrl:process.env.FOCUS_TEST_LOCAL_URL};} export async function getLocalPostgres(){if(process.env.FOCUS_TEST_FORBID_BOOTSTRAP==='true')throw Error('FIXTURE_BOOTSTRAP_INVOKED');return readLocalPostgres();}\n");
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');symlinkSync(new URL('../node_modules',import.meta.url).pathname,join(dir,'node_modules'),'dir');
  mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist','index.html'),'<html>Fictional managed-server fixture</html>');
  mkdirSync(join(dir,'.data'),{mode:0o700});const access=join(dir,'.data','demo-access.json'),legacy=join(dir,'.data','demo.sqlite');
  const accessText='{"database":".data/demo.sqlite","notice":"fictional old access"}',legacyText='fictional SQLite sentinel';writeFileSync(access,accessText,{mode:0o600});writeFileSync(legacy,legacyText,{mode:0o600});
  db=await openDatabase(target.toString(),{migrate:true});
  const email='managed-adoption@example.test',password=randomBytes(24).toString('base64url');
  await createOwner(db,{email,password,display_name:'Fictional managed adoption'});
  const backup=join(dir,'.data','before-adoption.json');await backupPostgres(db,backup);
  command('scripts/adopt-local-postgres.ts',['--database','demo','--backup',backup]);
  assert.equal(readFileSync(access,'utf8'),accessText);assert.equal(readFileSync(legacy,'utf8'),legacyText);
  for(const partialState of [{FOCUS_TEST_ACCOUNT_READY:'false'},{FOCUS_TEST_READY:'false'}]){
   const partial=spawnSync(process.execPath,['--import',loader,join(dir,'.devcontainer','postgres.mjs'),'setup'],{cwd:dir,env:{...env,...partialState,FOCUS_TEST_FORBID_BOOTSTRAP:'true'},encoding:'utf8',timeout:15000});
   assert.equal(partial.status,1);assert.match(partial.stderr,/Recupera el archivo original/);assert.doesNotMatch(partial.stderr,/FIXTURE_BOOTSTRAP_INVOKED/);
  }
  const activePath=join(dir,'.data','active-postgres.json'),activeBytes=readFileSync(activePath);
  writeFileSync(activePath,JSON.stringify({...JSON.parse(activeBytes.toString()),identity:'pg:'+'0'.repeat(64)}));
  const mismatched=spawnSync(process.execPath,['--import',loader,join(dir,'.devcontainer','postgres.mjs'),'setup'],{cwd:dir,env,encoding:'utf8',timeout:15000});
  assert.equal(mismatched.status,1);assert.match(mismatched.stderr,/identidad del destino adoptado no coincide/);writeFileSync(activePath,activeBytes);
  command('.devcontainer/postgres.mjs',['setup']);command('.devcontainer/postgres.mjs',['start']);
  const pidPath=join(dir,'.data','codespaces-server.pid'),firstPid=JSON.parse(readFileSync(pidPath,'utf8')).pid;
  command('.devcontainer/postgres.mjs',['start']);assert.equal(JSON.parse(readFileSync(pidPath,'utf8')).pid,firstPid);
  const base=`http://127.0.0.1:${port}`,challenge=await fetch(base+'/api/session/challenge');assert.equal(challenge.status,200);
  const loginToken=(await challenge.json()).loginToken;
  const login=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Cookie:challenge.headers.get('set-cookie')!.split(';')[0],'X-Login-CSRF':loginToken},body:JSON.stringify({email,password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0],csrf=(await login.json()).csrfToken;
  const captured=await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({text:'Fictional durable managed capture',request_id:randomUUID()})});assert.equal(captured.status,201);
  const task=(await captured.json()).tasks[0];assert.ok(task.id);
  command('.devcontainer/service.mjs',['stop']);command('.devcontainer/postgres.mjs',['start']);
  const state=await fetch(base+'/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);assert.ok((await state.json()).tasks.some((row:{id:string})=>row.id===task.id));
  assert.equal(readFileSync(access,'utf8'),accessText);assert.equal(readFileSync(legacy,'utf8'),legacyText);
  const binding=readActivePostgresBinding(join(dir,'.data','active-postgres.json'));assert.equal(binding?.identity,db.identity);
 }finally{
  if(existsSync(join(dir,'.data','codespaces-server.pid')))command('.devcontainer/service.mjs',['stop']);
  await db?.close();
  try{if(created&&/^focus_adopt_[a-f0-9]{32}$/.test(name))await admin.query(`DROP DATABASE ${name}`);}finally{await admin.end();rmSync(dir,{recursive:true,force:true});}
 }
});
