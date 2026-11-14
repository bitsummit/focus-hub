import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createTestDatabase} from './postgres-fixture.ts';
import {createOwner} from '../server/auth.ts';
import {Domain} from '../server/domain.ts';
import {RECOVERY_TABLES} from '../server/data-tables.ts';
import {backupPostgres} from '../server/postgres-recovery.ts';
import {rehearsePostgresRecovery} from '../server/recovery-rehearsal.ts';

async function fixture(){
 const fixture=await createTestDatabase(),db=fixture.db,dir=mkdtempSync(join(tmpdir(),'focus-rehearsal-test-'));
 const password=randomBytes(24).toString('base64url'),user=await createOwner(db,{email:'rehearsal@example.test',password,display_name:'Fictional recovery rehearsal'});
 const workspace=(await db.one('SELECT id FROM workspaces'))!.id;
 const domain=new Domain(db,{user_id:user.id,workspace_id:String(workspace)});
 const goal=await domain.createEntity('goals',{title:'Fictional recovery goal'});
 const project=await domain.createEntity('projects',{name:'Fictional recovery project',goal_id:goal.id});
 await domain.createEntity('milestones',{title:'Fictional milestone',project_id:project.id,goal_id:goal.id});
 const task=await domain.capture({text:'Fictional recovery parent',request_id:randomUUID(),project_id:project.id,journal_date:'2026-11-14'});
 await domain.capture({text:'Fictional child',parent_task_id:task.id,request_id:randomUUID(),project_id:project.id});
 await domain.updateTask(task.id,{status:'completed'});await domain.updateTask(task.id,{status:'pending_review'});
 await domain.setFocus('daily','2026-11-14',[task.id]);
 await db.run('INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',['f'.repeat(64),user.id,'fictional-csrf','2030-01-01T00:00:00.000Z','2026-11-14T00:00:00.000Z']);
 const backup=join(dir,'backup.json');await backupPostgres(db,backup);
 return {...fixture,dir,backup,password,async close(){await fixture.close();rmSync(dir,{recursive:true,force:true});}};
}
async function rows(db:Awaited<ReturnType<typeof createTestDatabase>>['db']){const result:Record<string,unknown>={};for(const table of RECOVERY_TABLES)result[table]=await db.all(`SELECT * FROM ${table}`);return result;}
async function recoverySchemas(db:Awaited<ReturnType<typeof createTestDatabase>>['db']){return db.all("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'focus_recovery_%' ORDER BY nspname");}

test('recovery rehearsal restores all canonical cells, revokes only cloned sessions and removes its private schema',async()=>{
 const f=await fixture();
 try{
  const before=await rows(f.db),schemas=await recoverySchemas(f.db),bytes=readFileSync(f.backup);
  const result=await rehearsePostgresRecovery(f.url,f.schema,f.backup);
  assert.equal(result.integrity,'ok');assert.equal(result.databaseIdentity,f.db.identity);assert.equal(result.temporarySchemaRemoved,true);
  assert.equal(result.counts.tasks,2);assert.equal(result.counts.sessions,0);assert.equal(result.sessionsRevoked,1);
  assert.ok(result.backupSha256.length===64);assert.ok(!JSON.stringify(result).includes(f.password));assert.ok(!JSON.stringify(result).includes('password_hash'));
  assert.deepEqual(await rows(f.db),before);assert.deepEqual(await recoverySchemas(f.db),schemas);assert.deepEqual(readFileSync(f.backup),bytes);
 }finally{await f.close();}
});

test('recovery rehearsal cleans only its temporary schema after relational restore failure',async()=>{
 const f=await fixture();
 try{
  const before=await rows(f.db),schemas=await recoverySchemas(f.db),bad=join(f.dir,'bad-reference.json');
  const payload=JSON.parse(readFileSync(f.backup,'utf8'));payload.tables.tasks[0].project_id='missing-project';delete payload.sha256;payload.sha256=createHash('sha256').update(JSON.stringify(payload)).digest('hex');writeFileSync(bad,JSON.stringify(payload));
  await assert.rejects(rehearsePostgresRecovery(f.url,f.schema,bad));
  assert.deepEqual(await rows(f.db),before);assert.deepEqual(await recoverySchemas(f.db),schemas);
 }finally{await f.close();}
});

test('recovery rehearsal rejects invalid backup input, symlinks and missing connection without modifying the source',async()=>{
 const f=await fixture();
 try{
  const before=await rows(f.db),schemas=await recoverySchemas(f.db),bad=join(f.dir,'bad-checksum.json'),alias=join(f.dir,'backup-alias.json');
  writeFileSync(bad,readFileSync(f.backup,'utf8').replace('Fictional recovery parent','Changed backup'));symlinkSync(f.backup,alias);
  await assert.rejects(rehearsePostgresRecovery(f.url,f.schema,bad),/checksum/);
  await assert.rejects(rehearsePostgresRecovery(f.url,f.schema,alias),/symlink/);
  await assert.rejects(rehearsePostgresRecovery('',f.schema,f.backup),/explicit/);
  assert.deepEqual(await rows(f.db),before);assert.deepEqual(await recoverySchemas(f.db),schemas);
 }finally{await f.close();}
});

test('recovery rehearsal CLI works without SQLite and prints only a safe report',async()=>{
 const f=await fixture();
 try{
  const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:f.url,DATABASE_SCHEMA:f.schema};delete env.FOCUS_DB;delete env.FOCUS_DEMO;
  const cli=resolve('scripts/rehearse-recovery.ts'),loader=resolve('node_modules/tsx/dist/loader.mjs');
  const child=spawnSync(process.execPath,['--no-experimental-sqlite','--import',loader,cli,'--source',f.backup],{cwd:f.dir,env,encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);const report=JSON.parse(child.stdout);assert.equal(report.counts.tasks,2);
  for(const secret of [f.password,f.url,'password_hash','fictional-csrf'])assert.ok(!child.stdout.includes(secret)&&!child.stderr.includes(secret));
  const missing=spawnSync(process.execPath,['--no-experimental-sqlite','--import',loader,cli],{cwd:f.dir,env,encoding:'utf8',timeout:10000});
  assert.equal(missing.status,1);assert.ok(!missing.stderr.includes(f.url));
 }finally{await f.close();}
});
