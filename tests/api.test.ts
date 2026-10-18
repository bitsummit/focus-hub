import { createTestDatabase } from './postgres-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createOwner } from '../server/auth.js';
import type { Snapshot } from '../shared/contracts.js';
const password = 'Fictional-QA-password-2026!';
async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'focus-hub-qa-'));
    const fixtureDB = await createTestDatabase();
    const path = fixtureDB.url;
    const db = fixtureDB.db;
    await createOwner(db, { email: 'a@example.test', password, display_name: 'Persona ficticia A' });
    await createOwner(db, { email: 'b@example.test', password, display_name: 'Persona ficticia B' });
    const server = createApp(db).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw Error('Missing address');
    const base = `http://127.0.0.1:${address.port}`;
    async function login(email: string) {
        const challenge = await fetch(base + '/api/session/challenge');
        assert.equal(challenge.status, 200);
        const { loginToken } = await challenge.json();
        const challengeCookie = challenge.headers.get('set-cookie')!.split(';')[0];
        const r = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: challengeCookie, 'X-Login-CSRF': loginToken }, body: JSON.stringify({ email, password }) });
        assert.equal(r.status, 200, await r.clone().text());
        const session = await r.json();
        const cookie = r.headers.get('set-cookie')!.split(';')[0];
        async function request(method: string, url: string, data?: unknown, extra: Record<string, string> = {}) {
            return fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base, 'X-CSRF-Token': session.csrfToken, ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
        }
        async function ok(method: string, url: string, data?: unknown): Promise<any> { const r = await request(method, url, data); assert.ok(r.ok, `${method} ${url}: ${r.status} ${await r.clone().text()}`); return r.json(); }
        return { request, ok, cookie };
    }
    return { db, path, schema: fixtureDB.schema, base, login, close: async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await fixtureDB.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function newTask(state: Snapshot, title: string) { const task = state.tasks.find(t => t.title === title); assert.ok(task, `Task ${title} missing`); return task; }
test('01,05,06: capture is idempotent, durable across connections, completion and reopening preserve audited history', async () => {
    const f = await fixture();
    try {
        const a = await f.login('a@example.test');
        const request_id = randomUUID();
        let state = await a.ok('POST', '/api/tasks', { text: 'Preparar presentación', request_id });
        const task = newTask(state, 'Preparar presentación');
        state = await a.ok('POST', '/api/tasks', { text: 'Preparar presentación', request_id });
        assert.equal(state.tasks.length, 1);
        assert.equal(state.events.filter((e: any) => e.event_type === 'created').length, 1);
        const reopenedDb = (await openDatabase(f.path, { schema: f.schema }));
        assert.equal(((await reopenedDb.one("SELECT title FROM tasks WHERE id=$1", [task.id])) as any).title, task.title);
        (await reopenedDb.close());
        state = await a.ok('PATCH', `/api/tasks/${task.id}`, { status: 'completed' });
        assert.ok(newTask(state, task.title).completed_at);
        assert.equal(state.events.filter((e: any) => e.event_type === 'completed').length, 1);
        state = await a.ok('PATCH', `/api/tasks/${task.id}`, { status: 'completed' });
        assert.equal(state.events.filter((e: any) => e.event_type === 'completed').length, 1);
        state = await a.ok('PATCH', `/api/tasks/${task.id}`, { status: 'pending' });
        assert.equal(newTask(state, task.title).completed_at, null);
        assert.equal(state.events.filter((e: any) => e.event_type === 'completed').length, 1);
        assert.equal(state.events.filter((e: any) => e.event_type === 'reopened').length, 1);
        state = await a.ok('PATCH', `/api/tasks/${task.id}`, { status: 'completed' });
        const year = new Date().getUTCFullYear();
        const analytics = await a.ok('GET', `/api/analytics?start=${year}-01-01&end=${year + 1}-01-01`);
        assert.equal(analytics.created, 1);
        assert.equal(analytics.completed, 1);
        assert.equal(analytics.reopened, 1);
    }
    finally {
        await f.close();
    }
});
test('02,03,04,07: journal project parsing, task references, revisions, nesting and synchronization', async () => {
    const f = await fixture();
    try {
        const a = await f.login('a@example.test');
        let s = await a.ok('POST', '/api/projects', { name: 'SRA' });
        const project = s.projects[0];
        const date = '2026-10-15';
        s = await a.ok('POST', `/api/journals/${date}/blocks`, { text: '# SRA', request_id: randomUUID(), revision: 0 });
        s = await a.ok('POST', `/api/journals/${date}/blocks`, { text: 'Notas ficticias del día', request_id: randomUUID(), revision: 1 });
        const request_id = randomUUID();
        const append = { text: '- [ ] !! Preparar presentación #SRA', request_id, revision: 2 };
        s = await a.ok('POST', `/api/journals/${date}/blocks`, append);
        const task = newTask(s, 'Preparar presentación');
        assert.equal(task.priority, 'critical');
        assert.equal(task.project_id, project.id);
        s = await a.ok('POST', `/api/journals/${date}/blocks`, append);
        assert.equal(s.tasks.length, 1);
        assert.equal(s.blocks.filter((b: any) => b.task_id === task.id).length, 1);
        const stale = await a.request('POST', `/api/journals/${date}/blocks`, { text: 'Conflicto', request_id: randomUUID(), revision: 0 });
        assert.equal(stale.status, 409);
        s = await a.ok('POST', `/api/journals/${date}/blocks`, { text: '- [ ] Subtarea ficticia', request_id: randomUUID(), revision: 3, indent_level: 1 });
        const sub = newTask(s, 'Subtarea ficticia');
        assert.equal(sub.parent_task_id, task.id);
        assert.equal(sub.project_id, project.id);
        assert.equal((await a.request('PATCH', `/api/tasks/${task.id}`, { parent_task_id: sub.id })).status, 400);
        assert.equal((await a.request('POST', `/api/journals/${date}/blocks`, { ...append, text: '- [ ] Otro contenido' })).status, 409);
        for (const status of ['in_progress', 'pending_review', 'waiting_external'])
            s = await a.ok('PATCH', `/api/tasks/${task.id}`, { status, waiting_on: 'Revisión ficticia', follow_up_at: '2026-10-20' });
        s = await a.ok('GET', '/api/state');
        assert.equal(newTask(s, task.title).status, 'waiting_external');
        assert.equal(newTask(s, task.title).follow_up_at, '2026-10-20');
        assert.equal(s.blocks.find((b: any) => b.task_id === task.id).task_id, task.id);
        assert.equal(s.journals[0].entry_date, date);
        const block = s.blocks.find((b: any) => b.task_id === task.id);
        await a.ok('DELETE', `/api/blocks/${block.id}`, { revision: s.journals[0].revision });
        s = await a.ok('GET', '/api/state');
        assert.equal(s.tasks.length, 2);
        assert.ok(s.blocks.some((b: any) => b.text_content === 'Notas ficticias del día'));
    }
    finally {
        await f.close();
    }
});
test('08,09,12: ordered period focus, independent milestones and full-fidelity exports', async () => {
    const f = await fixture();
    try {
        const a = await f.login('a@example.test');
        let s = await a.ok('POST', '/api/tasks', { text: 'Primera', request_id: randomUUID() });
        const one = newTask(s, 'Primera');
        s = await a.ok('POST', '/api/tasks', { text: 'Segunda', request_id: randomUUID() });
        const two = newTask(s, 'Segunda');
        await a.ok('PUT', '/api/focus/weekly/2026-10-12', { task_ids: [two.id, one.id] });
        await a.ok('PUT', '/api/focus/daily/2026-10-16', { task_ids: [one.id] });
        s = await a.ok('GET', '/api/state');
        assert.deepEqual(s.focus.filter((x: any) => x.period_type === 'weekly').sort((a: any, b: any) => a.sort_order - b.sort_order).map((x: any) => x.task_id), [two.id, one.id]);
        await a.ok('PATCH', `/api/tasks/${one.id}`, { status: 'completed' });
        await a.ok('PUT', '/api/focus/weekly/2026-10-12', { task_ids: [one.id, two.id] });
        assert.equal((await a.request('PUT', '/api/focus/weekly/2026-10-19', { task_ids: [one.id] })).status, 400);
        await a.ok('PATCH', `/api/tasks/${one.id}`, { status: 'pending' });
        s = await a.ok('POST', '/api/goals', { title: 'Objetivo ficticio' });
        const goal = s.goals[0];
        s = await a.ok('POST', '/api/milestones', { title: 'Resultado comprobable', goal_id: goal.id });
        const milestone = s.milestones[0];
        s = await a.ok('PATCH', `/api/milestones/${milestone.id}`, { status: 'achieved' });
        assert.ok(s.milestones[0].achieved_at);
        assert.equal(s.tasks.filter((t: any) => t.status === 'completed').length, 0);
        const exported = await a.ok('GET', '/api/export?format=json');
        assert.ok(exported.schemaVersion);
        const serialized = JSON.stringify(exported);
        for (const id of [one.id, two.id, goal.id, milestone.id])
            assert.ok(serialized.includes(id));
        for (const key of ['tasks', 'events', 'blocks', 'journals', 'focus', 'projects', 'goals', 'milestones'])
            assert.ok(serialized.includes(`"${key}"`), `missing ${key}`);
        await a.ok('POST', '/api/tasks', { text: '=FORMULA', request_id: randomUUID() });
        const csv = await a.request('GET', '/api/export?format=csv');
        assert.equal(csv.status, 200);
        const contents = await csv.text();
        assert.ok(contents.includes(one.id));
        assert.ok(contents.includes("'=FORMULA"));
    }
    finally {
        await f.close();
    }
});
test('13: authentication, logout, CSRF, origin checks and cross-tenant IDs/relations', async () => {
    const f = await fixture();
    try {
        assert.equal((await fetch(f.base + '/api/state')).status, 401);
        const a = await f.login('a@example.test'), b = await f.login('b@example.test');
        let s = await b.ok('POST', '/api/projects', { name: 'Proyecto de B' });
        const project = s.projects[0];
        s = await b.ok('POST', '/api/tasks', { text: 'Privada B', request_id: randomUUID() });
        const task = newTask(s, 'Privada B');
        s = await b.ok('POST', '/api/goals', { title: 'Meta privada B' });
        const goal = s.goals[0];
        s = await b.ok('POST', '/api/milestones', { title: 'Hito privado B', goal_id: goal.id });
        const milestone = s.milestones[0];
        s = await b.ok('POST', '/api/journals/2026-10-16/blocks', { text: 'Nota privada B', revision: 0, request_id: randomUUID() });
        const block = s.blocks[0];
        assert.equal((await a.ok('GET', '/api/state')).tasks.length, 0);
        assert.equal((await a.request('GET', `/api/tasks/${task.id}/events`)).status, 404);
        for (const [path, data] of [[`/api/projects/${project.id}`, { name: 'Ataque' }], [`/api/goals/${goal.id}`, { title: 'Ataque' }], [`/api/milestones/${milestone.id}`, { status: 'achieved' }], [`/api/blocks/${block.id}`, { text_content: 'Ataque', revision: 1 }]] as const)
            assert.equal((await a.request('PATCH', path, data)).status, 404);
        assert.equal((await a.request('DELETE', `/api/blocks/${block.id}`, { revision: 1 })).status, 404);
        assert.equal((await a.ok('GET', '/api/journals/2026-10-16')).entry, null);
        for (const method of ['PATCH', 'DELETE']) {
            const r = await a.request(method, `/api/tasks/${task.id}`, method === 'PATCH' ? { title: 'Ataque' } : {});
            assert.ok([403, 404].includes(r.status));
        }
        for (const input of [{ text: 'Ataque', project_id: project.id }, { text: 'Ataque', parent_task_id: task.id }]) {
            const r = await a.request('POST', '/api/tasks', { ...input, request_id: randomUUID() });
            assert.ok([400, 403, 404, 422].includes(r.status));
        }
        assert.ok([403, 404].includes((await a.request('PUT', '/api/focus/daily/2026-10-16', { task_ids: [task.id] })).status));
        const csrf = await a.request('POST', '/api/tasks', { text: 'No CSRF', request_id: randomUUID() }, { 'X-CSRF-Token': '' });
        assert.equal(csrf.status, 403);
        const origin = await a.request('POST', '/api/tasks', { text: 'Bad origin', request_id: randomUUID() }, { Origin: 'https://evil.example' });
        assert.equal(origin.status, 403);
        const invalid = await b.request('PATCH', `/api/tasks/${task.id}`, { status: 'invalid' });
        assert.ok([400, 422].includes(invalid.status));
        s = await b.ok('GET', '/api/state');
        assert.equal(newTask(s, 'Privada B').title, 'Privada B');
        const logout = await a.request('DELETE', '/api/session');
        assert.ok(logout.ok);
        assert.equal((await a.request('GET', '/api/state')).status, 401);
    }
    finally {
        await f.close();
    }
});
test('10,11,12: verified historical events use local period bounds and remain in archive/export after soft deletion', async () => {
    const f = await fixture();
    try {
        const a = await f.login('a@example.test');
        let s = await a.ok('POST', '/api/tasks', { text: 'Logro ficticio de septiembre', request_id: randomUUID() });
        const old = newTask(s, 'Logro ficticio de septiembre');
        await a.ok('PATCH', `/api/tasks/${old.id}`, { status: 'completed' });
        (await f.db.run("UPDATE tasks SET created_at='2026-09-20T10:00:00.000Z',completed_at='2026-09-21T10:00:00.000Z' WHERE id=$1", [old.id]));
        (await f.db.run("UPDATE task_events SET occurred_at=CASE WHEN event_type='created' THEN '2026-09-20T10:00:00.000Z' ELSE '2026-09-21T10:00:00.000Z' END WHERE task_id=$1", [old.id]));
        s = await a.ok('POST', '/api/tasks', { text: 'Captura al cruzar medianoche UTC', request_id: randomUUID() });
        const boundary = newTask(s, 'Captura al cruzar medianoche UTC');
        (await f.db.run("UPDATE tasks SET created_at='2026-10-15T22:30:00.000Z' WHERE id=$1", [boundary.id]));
        (await f.db.run("UPDATE task_events SET occurred_at='2026-10-15T22:30:00.000Z' WHERE task_id=$1", [boundary.id]));
        const previous = await a.ok('GET', '/api/analytics?start=2026-10-15&end=2026-10-16');
        assert.equal(previous.created, 0);
        const localDay = await a.ok('GET', '/api/analytics?start=2026-10-16&end=2026-10-17');
        assert.equal(localDay.created, 1);
        const september = await a.ok('GET', '/api/analytics?start=2026-09-21&end=2026-09-28');
        assert.equal(september.completed, 1);
        assert.equal(september.achievements[0].task_id, old.id);
        s = await a.ok('GET', '/api/state');
        assert.equal(newTask(s, old.title).completed_at, '2026-09-21T10:00:00.000Z');
        await a.ok('DELETE', `/api/tasks/${old.id}`);
        const exported = await a.ok('GET', '/api/export?format=json');
        assert.ok(exported.tasks.some((t: any) => t.id === old.id && t.deleted_at));
        assert.ok(exported.events.some((e: any) => e.task_id === old.id && e.event_type === 'completed'));
    }
    finally {
        await f.close();
    }
});
test('PostgreSQL concurrent captures serialize request identity and journal revisions reject stale writers', async () => {
    const f = await fixture();
    try {
        const a = await f.login('a@example.test'), request_id = randomUUID();
        const results = await Promise.all(Array.from({ length: 6 }, () => a.request('POST', '/api/tasks', { text: 'Concurrent fictional capture', request_id })));
        for (const result of results)
            assert.equal(result.status, 201, await result.clone().text());
        let state = await a.ok('GET', '/api/state');
        assert.equal(state.tasks.length, 1);
        assert.equal(state.events.filter((event: any) => event.event_type === 'created').length, 1);
        assert.equal((await a.request('POST', '/api/tasks', { text: 'Changed payload', request_id })).status, 409);
        const writes = await Promise.all(['First writer', 'Second writer'].map(text => a.request('POST', '/api/journals/2026-10-16/blocks', { text, revision: 0, request_id: randomUUID() })));
        assert.deepEqual(writes.map(result => result.status).sort(), [201, 409]);
        state = await a.ok('GET', '/api/state');
        assert.equal(state.journals.length, 1);
        assert.equal(state.journals[0].revision, 1);
        assert.equal(state.blocks.length, 1);
    }
    finally {
        await f.close();
    }
});
test('PostgreSQL rollback spans awaited operations and nested savepoints retain outer ownership', async () => {
    const fixtureDB = await createTestDatabase(), { db } = fixtureDB;
    try {
        const { transaction } = await import('../server/db.ts');
        await assert.rejects(transaction(db, async () => {
            await createOwner(db, { email: 'rollback@example.test', password: 'Fictional-Rollback-2026!' });
            await new Promise(resolve => setTimeout(resolve, 5));
            assert.equal((await db.all('SELECT id FROM users')).length, 1);
            throw Error('Fictional transaction rollback');
        }), /Fictional transaction rollback/);
        for (const table of ['users', 'workspaces', 'workspace_members'])
            assert.equal((await db.all(`SELECT * FROM ${table}`)).length, 0);
        await transaction(db, async () => {
            const user = await createOwner(db, { email: 'outer@example.test', password: 'Fictional-Rollback-2026!' });
            await assert.rejects(transaction(db, async () => { await db.run('UPDATE users SET display_name=$1 WHERE id=$2', ['Rolled-back nested mutation', user.id]); throw Error('nested'); }), /nested/);
            assert.notEqual((await db.one('SELECT display_name FROM users WHERE id=$1', [user.id]))!.display_name, 'Rolled-back nested mutation');
        });
        assert.equal((await db.all('SELECT id FROM users')).length, 1);
    }
    finally {
        await fixtureDB.close();
    }
});

test('PostgreSQL concurrent parent edits cannot create a cycle and focus replacement stays atomic',async()=>{
 const f=await fixture();try{
  const a=await f.login('a@example.test');
  await a.ok('POST','/api/tasks',{text:'Concurrent parent A',request_id:randomUUID()});
  let state=await a.ok('POST','/api/tasks',{text:'Concurrent parent B',request_id:randomUUID()});
  const [one,two]=state.tasks;
  const updates=await Promise.all([a.request('PATCH',`/api/tasks/${one.id}`,{parent_task_id:two.id}),a.request('PATCH',`/api/tasks/${two.id}`,{parent_task_id:one.id})]);
  assert.deepEqual(updates.map(result=>result.status).sort(),[200,400]);
  await a.ok('PATCH',`/api/tasks/${one.id}`,{parent_task_id:null});await a.ok('PATCH',`/api/tasks/${two.id}`,{parent_task_id:null});
  const focus=await Promise.all([[one.id,two.id],[two.id]].map(task_ids=>a.request('PUT','/api/focus/daily/2026-10-16',{task_ids})));
  for(const result of focus)assert.equal(result.status,200,await result.clone().text());
  state=await a.ok('GET','/api/state');const selected=state.focus.filter((item:any)=>item.period_type==='daily'&&item.period_start==='2026-10-16').sort((left:any,right:any)=>left.sort_order-right.sort_order).map((item:any)=>item.task_id);
  assert.ok(JSON.stringify(selected)===JSON.stringify([one.id,two.id])||JSON.stringify(selected)===JSON.stringify([two.id]));
  assert.ok(!JSON.stringify(state).includes('storage_order'),'PostgreSQL ordering metadata must not leak into the API');
  const exported=await a.ok('GET','/api/export?format=json');assert.ok(!JSON.stringify(exported).includes('storage_order'));
 }finally{await f.close();}
});

test('PostgreSQL migrations repeat safely, require explicit initialization, and enforce database constraints',async()=>{
 const fixtureDB=await createTestDatabase(),{db}=fixtureDB;
 const {migrateDatabase,verifyMigrations}=await import('../server/db.ts');
 const emptySchema=`focus_test_${randomUUID().replaceAll('-','')}`;
 try{
  const before=await verifyMigrations(db);assert.equal(before.length,2);
  await migrateDatabase(db);await migrateDatabase(db);assert.deepEqual(await verifyMigrations(db),before);
  await db.exec(`CREATE SCHEMA "${emptySchema}"`);
  await assert.rejects(openDatabase(fixtureDB.url,{schema:emptySchema}),/migraciones/i);
  assert.equal((await db.one('SELECT count(*)::integer AS n FROM information_schema.tables WHERE table_schema=$1',[emptySchema]))!.n,0,'opening an uninitialized target must not bootstrap a replacement');
  const a=await createOwner(db,{email:'constraints-a@example.test',password:'Fictional-Constraints-2026!'}),b=await createOwner(db,{email:'constraints-b@example.test',password:'Fictional-Constraints-2026!'});
  const workspace=(await db.one('SELECT id FROM workspaces WHERE owner_user_id=$1',[a.id]))!.id;
  const foreign=(await db.one('SELECT id FROM workspaces WHERE owner_user_id=$1',[b.id]))!.id;
  await assert.rejects(db.run('UPDATE users SET email=$1 WHERE id=$2',['CONSTRAINTS-A@EXAMPLE.TEST',b.id]),(error:any)=>error.code==='23505');
  const {Domain}=await import('../server/domain.ts');const aDomain=new Domain(db,{user_id:a.id,workspace_id:workspace}),bDomain=new Domain(db,{user_id:b.id,workspace_id:foreign});
  const task=await aDomain.capture({text:'Constraint fixture',request_id:randomUUID()}),project=await bDomain.createEntity('projects',{name:'Foreign fixture project'});
  await assert.rejects(db.run('UPDATE tasks SET status=$1 WHERE id=$2',['imaginary',task.id]),(error:any)=>error.code==='23514');
  await assert.rejects(db.run('UPDATE tasks SET project_id=$1 WHERE id=$2',[project.id,task.id]),(error:any)=>error.code==='23503');
  assert.equal((await aDomain.snapshot()).tasks[0].status,'pending');assert.equal((await aDomain.snapshot()).tasks[0].project_id,null);
  await db.run('UPDATE schema_migrations SET checksum=$1 WHERE version=1',['fictional-checksum-mismatch']);
  await assert.rejects(verifyMigrations(db),/incompatible/i);await assert.rejects(migrateDatabase(db),/incompatibles|modificadas/i);
  await db.run('UPDATE schema_migrations SET checksum=$1 WHERE version=1',[before[0].checksum]);assert.deepEqual(await verifyMigrations(db),before);
 }finally{await db.exec(`DROP SCHEMA IF EXISTS "${emptySchema}" CASCADE`);await fixtureDB.close();}
});

test('PostgreSQL first migration rejects unversioned Focus tables without adopting or mutating existing records',async()=>{
 const fixtureDB=await createTestDatabase(),{db}=fixtureDB;
 const {Database,migrateDatabase}=await import('../server/db.ts');
 const schema=`focus_test_${randomUUID().replaceAll('-','')}`;
 let unversioned:InstanceType<typeof Database>|undefined;
 try{
  await db.exec(`CREATE SCHEMA "${schema}"`);
  await db.exec(`CREATE TABLE "${schema}".tasks (id TEXT PRIMARY KEY,sentinel TEXT NOT NULL)`);
  const original={id:randomUUID(),sentinel:'Fictional pre-existing records must survive a refused migration'};
  await db.run(`INSERT INTO "${schema}".tasks(id,sentinel) VALUES($1,$2)`,[original.id,original.sentinel]);
  const columns=await db.all('SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[schema,'tasks']);
  unversioned=new Database(fixtureDB.url,{schema});
  await assert.rejects(migrateDatabase(unversioned),/tablas Focus sin ledger/i);
  assert.deepEqual(await unversioned.all('SELECT * FROM tasks'),[original]);
  assert.deepEqual(await db.all('SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[schema,'tasks']),columns);
  assert.deepEqual(await db.all('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name',[schema]),[{table_name:'tasks'}],'The failed migration must roll back its newly created ledger and leave the original table alone');
  await assert.rejects(openDatabase(fixtureDB.url,{schema,migrate:true}),/tablas Focus sin ledger/i);
  assert.deepEqual(await unversioned.all('SELECT * FROM tasks'),[original],'Retrying explicit initialization must also preserve the original records');
  assert.equal((await unversioned.one('SELECT to_regclass($1) AS name',[`${schema}.schema_migrations`]))!.name,null);
 }finally{
  await unversioned?.close();
  await db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await fixtureDB.close();
 }
});
