import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {openDatabase} from '../server/db.ts';
import {createOwner,verifyPassword} from '../server/auth.ts';

const cli=resolve('server/password.ts');
const loader=import.meta.resolve('tsx');
const email='rotation@example.test';
function fixture(demo=false){
 const directory=mkdtempSync(join(tmpdir(),'focus-password-test-'));
 mkdirSync(join(directory,'.data'),{mode:0o700});
 const database=join(directory,'.data',demo?'demo.sqlite':'focus-hub.sqlite');
 const db=openDatabase(database);
 const oldPassword=randomBytes(24).toString('hex');
 const user=createOwner(db,{email,password:oldPassword,display_name:'Fictional fixture'});
 const other=createOwner(db,{email:'other@example.test',password:randomBytes(24).toString('hex')});
 for(const [id,user_id] of [['first',user.id],['second',other.id]])db.prepare('INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)').run(id,user_id,'fixture-token','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z');
 const access=join(directory,'.data/demo-access.json');
 if(demo)writeFileSync(access,JSON.stringify({email,password:oldPassword,database:'.data/demo.sqlite',notice:'fictional fixture',custom:{keep:true}}),{mode:0o600});
 return {directory,database,db,user,other,oldPassword,access,close(){db.close();rmSync(directory,{recursive:true,force:true});}};
}
function run(directory:string,input:string,database?:string,args:string[]=[]){
 return spawnSync(process.execPath,['--import',loader,cli,...args],{cwd:directory,input,encoding:'utf8',env:{...process.env,FOCUS_DB:database??''},timeout:15000});
}
function unchanged(f:ReturnType<typeof fixture>){
 const row=f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(f.user.id)!;
 assert.ok(verifyPassword(f.oldPassword,String(row.password_hash)),'The previous password must remain valid');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n,2);
}
test('password CLI rotates an existing account and revokes only its sessions without printing credentials',()=>{
 const f=fixture(),password=randomBytes(24).toString('hex');
 try{
  const workspace=f.db.prepare('SELECT * FROM workspaces WHERE owner_user_id=?').get(f.user.id);
  const result=run(f.directory,`  ${email.toUpperCase()}  \n${password}\n`);
  assert.equal(result.status,0,result.stderr);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(password),'Never print the new password');
  assert.ok(!`${result.stdout}${result.stderr}`.includes(f.oldPassword),'Never print the previous password');
  const user=f.db.prepare('SELECT * FROM users WHERE id=?').get(f.user.id)!;
  assert.ok(verifyPassword(password,String(user.password_hash)));
  assert.ok(!verifyPassword(f.oldPassword,String(user.password_hash)));
  assert.equal(user.display_name,'Fictional fixture');
  assert.deepEqual(f.db.prepare('SELECT * FROM workspaces WHERE owner_user_id=?').get(f.user.id),workspace);
  assert.deepEqual(f.db.prepare('SELECT id_hash FROM sessions').all().map(x=>x.id_hash),['second']);
  assert.equal(existsSync(f.access),false);
 }finally{f.close();}
});
test('demo rotation atomically updates its access file, preserves fields, and keeps mode 0600',()=>{
 const f=fixture(true),password=randomBytes(24).toString('hex');
 try{
  const result=run(f.directory,`${email}\n${password}\n`,f.database);
  assert.equal(result.status,0,result.stderr);
  const access=JSON.parse(readFileSync(f.access,'utf8'));
  assert.ok(access.password===password,'The local metadata must contain the new password');
  assert.deepEqual(access.custom,{keep:true});assert.equal(access.notice,'fictional fixture');
  assert.equal(statSync(f.access).mode&0o777,0o600);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
  assert.ok(verifyPassword(password,String(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(f.user.id)!.password_hash)));
  assert.deepEqual(readdirSync(join(f.directory,'.data')).filter(x=>x.startsWith('.password-')),[]);
 }finally{f.close();}
});
test('short passwords, invalid input and password arguments leave account and sessions intact',()=>{
 const f=fixture();
 try{
  for(const [input,args] of [[`${email}\n123456\n`,[]],[`${email}\n${'x'.repeat(257)}\n`,[]],[`${email}\n${'x'.repeat(4100)}`,[]],[`${email}\nvalid-password-value\nextra`,[]],[`${email}\nvalid-password-value\n`,['secret-argument']]] as [string,string[]][]){
   const result=run(f.directory,input,undefined,args);assert.notEqual(result.status,0);assert.ok(!result.stdout.includes('actualizada'));unchanged(f);
  }
 }finally{f.close();}
});
test('a missing database is not created by password CLI',()=>{
 const directory=mkdtempSync(join(tmpdir(),'focus-password-missing-'));
 try{
  const database=join(directory,'missing.sqlite');
  const result=run(directory,`${email}\nvalid-password-value\n`,database);
  assert.notEqual(result.status,0);assert.equal(existsSync(database),false);assert.deepEqual(readdirSync(directory),[]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('demo metadata mismatches, missing files, and symlinks reject before changing the database',()=>{
 for(const mode of ['mismatch','missing','symlink','invalid'] as const){
  const f=fixture(true);
  try{
   if(mode==='mismatch')writeFileSync(f.access,JSON.stringify({email:'wrong@example.test',database:'.data/demo.sqlite',password:'fictional-value'}));
   if(mode==='missing'||mode==='symlink')rmSync(f.access);
   if(mode==='symlink'){writeFileSync(join(f.directory,'outside.json'),'{}');symlinkSync(join(f.directory,'outside.json'),f.access);}
   if(mode==='invalid')writeFileSync(f.access,'{"password":"do-not-log-this-fixture-secret",');
   const result=run(f.directory,`${email}\nvalid-password-value\n`,f.database);
   assert.notEqual(result.status,0);unchanged(f);
   assert.ok(!`${result.stdout}${result.stderr}`.includes('do-not-log-this-fixture-secret'));
   assert.deepEqual(readdirSync(join(f.directory,'.data')).filter(x=>x.startsWith('.password-')),[]);
  }finally{f.close();}
 }
});
test('unknown account leaves its demo metadata and all sessions unchanged',()=>{
 const f=fixture(true);
 try{
  const original=readFileSync(f.access,'utf8');
  // The metadata is deliberately consistent with input, but no such DB account exists.
  writeFileSync(f.access,original.replace(email,'missing@example.test'));
  const before=readFileSync(f.access,'utf8');
  const result=run(f.directory,'missing@example.test\nvalid-password-value\n',f.database);
  assert.notEqual(result.status,0);unchanged(f);assert.equal(readFileSync(f.access,'utf8'),before);
  assert.deepEqual(readdirSync(join(f.directory,'.data')).filter(x=>x.startsWith('.password-')),[]);
 }finally{f.close();}
});

 test('concurrent metadata replacement rejects without changing password or sessions',async()=>{
 const f=fixture(true);let child:ReturnType<typeof spawn>|undefined;let locked=false;
 try{
  f.db.exec('BEGIN IMMEDIATE');locked=true;
  child=spawn(process.execPath,['--import',loader,cli],{cwd:f.directory,env:{...process.env,FOCUS_DB:f.database},stdio:['pipe','pipe','pipe']});
  const finished=once(child,'exit');
  child.stdin!.end(`${email}\nvalid-password-value\n`);
  let ready=false;
  for(let i=0;i<100;i++){
   if(readdirSync(join(f.directory,'.data')).filter(x=>x.startsWith('.password-')).length===2){ready=true;break;}
   await new Promise(r=>setTimeout(r,20));
  }
  assert.ok(ready,'CLI should stage metadata before waiting on its database transaction');
  rmSync(f.access);mkdirSync(f.access); // Simulate replacement while the CLI waits for its DB lock.
  f.db.exec('COMMIT');locked=false;
  const [code]=await finished;assert.notEqual(code,0);
  unchanged(f);
  assert.deepEqual(readdirSync(join(f.directory,'.data')).filter(x=>x.startsWith('.password-')),[]);
 }finally{
  if(locked)f.db.exec('ROLLBACK');
  if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}
  f.close();
 }
});
