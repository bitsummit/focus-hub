import { Pool } from 'pg';
import { createTestDatabase } from './postgres-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createOwner, verifyPassword } from '../server/auth.ts';
const cli = resolve('server/password.ts');
const loader = import.meta.resolve('tsx');
const email = 'rotation@example.test';
async function fixture(demo = false) {
    const directory = mkdtempSync(join(tmpdir(), 'focus-password-test-'));
    mkdirSync(join(directory, '.data'), { mode: 0o700 });
    const fixtureDB = await createTestDatabase();
    const db = fixtureDB.db;
    const database = db.identity;
    const oldPassword = randomBytes(24).toString('hex');
    const user = (await createOwner(db, { email, password: oldPassword, display_name: 'Fictional fixture' }));
    const other = (await createOwner(db, { email: 'other@example.test', password: randomBytes(24).toString('hex') }));
    for (const [id, user_id] of [['first', user.id], ['second', other.id]])
        (await db.run("INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,created_at) VALUES($1,$2,$3,$4,$5)", [id, user_id, 'fixture-token', '2099-01-01T00:00:00Z', '2026-01-01T00:00:00Z']));
    const access = join(directory, '.data/demo-access.json');
    if (demo)
        writeFileSync(access, JSON.stringify({ email, password: oldPassword, database, notice: 'fictional fixture', custom: { keep: true } }), { mode: 0o600 });
    return { directory, database, db, user, other, oldPassword, access, url: fixtureDB.url, schema: fixtureDB.schema, demo, async close() { await fixtureDB.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function run(f: Awaited<ReturnType<typeof fixture>>, input: string, _database?: string, args: string[] = []) {
    const directory = f.directory;
    return spawnSync(process.execPath, ['--import', loader, cli, ...args], { cwd: directory, input, encoding: 'utf8', env: { ...process.env, DATABASE_URL: f.url, DATABASE_SCHEMA: f.schema, FOCUS_DEMO: String(f.demo) }, timeout: 15000 });
}
async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
    const row = (await f.db.one("SELECT password_hash FROM users WHERE id=$1", [f.user.id]))!;
    assert.ok(verifyPassword(f.oldPassword, String(row.password_hash)), 'The previous password must remain valid');
    assert.equal((await f.db.one("SELECT COUNT(*)::integer AS n FROM sessions", []))!.n, 2);
}
test('password CLI rotates an existing account and revokes only its sessions without printing credentials', async () => {
    const f = (await fixture()), password = randomBytes(24).toString('hex');
    try {
        const workspace = (await f.db.one("SELECT * FROM workspaces WHERE owner_user_id=$1", [f.user.id]));
        const result = run(f, `  ${email.toUpperCase()}  \n${password}\n`);
        assert.equal(result.status, 0, result.stderr);
        assert.ok(!`${result.stdout}${result.stderr}`.includes(password), 'Never print the new password');
        assert.ok(!`${result.stdout}${result.stderr}`.includes(f.oldPassword), 'Never print the previous password');
        const user = (await f.db.one("SELECT * FROM users WHERE id=$1", [f.user.id]))!;
        assert.ok(verifyPassword(password, String(user.password_hash)));
        assert.ok(!verifyPassword(f.oldPassword, String(user.password_hash)));
        assert.equal(user.display_name, 'Fictional fixture');
        assert.deepEqual((await f.db.one("SELECT * FROM workspaces WHERE owner_user_id=$1", [f.user.id])), workspace);
        assert.deepEqual((await f.db.all("SELECT id_hash FROM sessions", [])).map(x => x.id_hash), ['second']);
        assert.equal(existsSync(f.access), false);
    }
    finally {
        (await f.close());
    }
});
test('demo rotation atomically updates its access file, preserves fields, and keeps mode 0600', async () => {
    const f = (await fixture(true)), password = randomBytes(24).toString('hex');
    try {
        const result = run(f, `${email}\n${password}\n`, f.database);
        assert.equal(result.status, 0, result.stderr);
        const access = JSON.parse(readFileSync(f.access, 'utf8'));
        assert.ok(access.password === password, 'The local metadata must contain the new password');
        assert.deepEqual(access.custom, { keep: true });
        assert.equal(access.notice, 'fictional fixture');
        assert.equal(statSync(f.access).mode & 0o777, 0o600);
        assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
        assert.ok(verifyPassword(password, String((await f.db.one("SELECT password_hash FROM users WHERE id=$1", [f.user.id]))!.password_hash)));
        assert.deepEqual(readdirSync(join(f.directory, '.data')).filter(x => x.startsWith('.password-')), []);
    }
    finally {
        (await f.close());
    }
});
test('short passwords, invalid input and password arguments leave account and sessions intact', async () => {
    const f = (await fixture());
    try {
        for (const [input, args] of [[`${email}\n123456\n`, []], [`${email}\n${'x'.repeat(257)}\n`, []], [`${email}\n${'x'.repeat(4100)}`, []], [`${email}\nvalid-password-value\nextra`, []], [`${email}\nvalid-password-value\n`, ['secret-argument']]] as [
            string,
            string[]
        ][]) {
            const result = run(f, input, undefined, args);
            assert.notEqual(result.status, 0);
            assert.ok(!result.stdout.includes('actualizada'));
            await unchanged(f);
        }
    }
    finally {
        (await f.close());
    }
});
test('a missing database is not created by password CLI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'focus-password-missing-'));
    try {
        const database = join(directory, 'missing.sqlite');
        const result = run({ directory, url: 'postgresql://127.0.0.1:1/focus_missing', schema: 'public', demo: false } as Awaited<ReturnType<typeof fixture>>, `${email}\nvalid-password-value\n`, database);
        assert.notEqual(result.status, 0);
        assert.equal(existsSync(database), false);
        assert.deepEqual(readdirSync(directory), []);
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
test('demo metadata mismatches, missing files, and symlinks reject before changing the database', async () => {
    for (const mode of ['mismatch', 'missing', 'symlink', 'invalid'] as const) {
        const f = (await fixture(true));
        try {
            if (mode === 'mismatch')
                writeFileSync(f.access, JSON.stringify({ email: 'wrong@example.test', database: '.data/demo.sqlite', password: 'fictional-value' }));
            if (mode === 'missing' || mode === 'symlink')
                rmSync(f.access);
            if (mode === 'symlink') {
                writeFileSync(join(f.directory, 'outside.json'), '{}');
                symlinkSync(join(f.directory, 'outside.json'), f.access);
            }
            if (mode === 'invalid')
                writeFileSync(f.access, '{"password":"do-not-log-this-fixture-secret",');
            const result = run(f, `${email}\nvalid-password-value\n`, f.database);
            assert.notEqual(result.status, 0);
            await unchanged(f);
            assert.ok(!`${result.stdout}${result.stderr}`.includes('do-not-log-this-fixture-secret'));
            assert.deepEqual(readdirSync(join(f.directory, '.data')).filter(x => x.startsWith('.password-')), []);
        }
        finally {
            (await f.close());
        }
    }
});
test('unknown account leaves its demo metadata and all sessions unchanged', async () => {
    const f = (await fixture(true));
    try {
        const original = readFileSync(f.access, 'utf8');
        // The metadata is deliberately consistent with input, but no such DB account exists.
        writeFileSync(f.access, original.replace(email, 'missing@example.test'));
        const before = readFileSync(f.access, 'utf8');
        const result = run(f, 'missing@example.test\nvalid-password-value\n', f.database);
        assert.notEqual(result.status, 0);
        await unchanged(f);
        assert.equal(readFileSync(f.access, 'utf8'), before);
        assert.deepEqual(readdirSync(join(f.directory, '.data')).filter(x => x.startsWith('.password-')), []);
    }
    finally {
        (await f.close());
    }
});
test('concurrent metadata replacement rejects without changing password or sessions', async () => {
    const f = (await fixture(true));
    const lockPool = new Pool({ connectionString: f.url, max: 1 });
    const locker = await lockPool.connect();
    let child: ReturnType<typeof spawn> | undefined;
    let locked = false;
    try {
        await locker.query('BEGIN');
        await locker.query(`SELECT id FROM "${f.schema}".users WHERE id=$1 FOR UPDATE`, [f.user.id]);
        locked = true;
        child = spawn(process.execPath, ['--import', loader, cli], { cwd: f.directory, env: { ...process.env, DATABASE_URL: f.url, DATABASE_SCHEMA: f.schema, FOCUS_DEMO: 'true' }, stdio: ['pipe', 'pipe', 'pipe'] });
        const finished = once(child, 'exit');
        child.stdin!.end(`${email}\nvalid-password-value\n`);
        let ready = false;
        for (let i = 0; i < 100; i++) {
            if (readdirSync(join(f.directory, '.data')).filter(x => x.startsWith('.password-')).length === 2) {
                ready = true;
                break;
            }
            await new Promise(r => setTimeout(r, 20));
        }
        assert.ok(ready, 'CLI should stage metadata before waiting on its database transaction');
        rmSync(f.access);
        mkdirSync(f.access); // Simulate replacement while the CLI waits for its DB lock.
        (await locker.query('COMMIT'));
        locked = false;
        const [code] = await finished;
        assert.notEqual(code, 0);
        await unchanged(f);
        assert.deepEqual(readdirSync(join(f.directory, '.data')).filter(x => x.startsWith('.password-')), []);
    }
    finally {
        if (locked)
            (await locker.query('ROLLBACK'));
        if (child && child.exitCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
        locker.release();
        await lockPool.end();
        (await f.close());
    }
});
test('PostgreSQL demo seed uses only an explicit empty target and never resets an existing owner', async () => {
    const f = await createTestDatabase(), directory = mkdtempSync(join(tmpdir(), 'focus-demo-pg-'));
    const invoke = () => spawnSync(process.execPath, ['--import', loader, resolve('server/demo.ts')], { cwd: directory, encoding: 'utf8', env: { ...process.env, DATABASE_URL: f.url, DATABASE_SCHEMA: f.schema }, timeout: 20000 });
    try {
        const seeded = invoke();
        assert.equal(seeded.status, 0, seeded.stderr);
        const accessPath = join(directory, '.data', 'demo-access.json'), original = readFileSync(accessPath, 'utf8'), access = JSON.parse(original);
        assert.equal(access.database, f.db.identity);
        assert.equal(statSync(accessPath).mode & 0o777, 0o600);
        assert.ok(!original.includes(f.url));
        assert.ok(!seeded.stdout.includes(access.password));
        const users = await f.db.all('SELECT id,password_hash FROM users'), tasks = await f.db.all('SELECT id,title FROM tasks ORDER BY id');
        assert.equal(users.length, 1);
        assert.ok(tasks.length > 0);
        assert.notEqual(invoke().status, 0);
        assert.equal(readFileSync(accessPath, 'utf8'), original);
        assert.deepEqual(await f.db.all('SELECT id,password_hash FROM users'), users);
        assert.deepEqual(await f.db.all('SELECT id,title FROM tasks ORDER BY id'), tasks);
        rmSync(accessPath);
        assert.notEqual(invoke().status, 0);
        assert.equal(existsSync(accessPath), false);
        assert.deepEqual(await f.db.all('SELECT id,password_hash FROM users'), users);
        assert.deepEqual(await f.db.all('SELECT id,title FROM tasks ORDER BY id'), tasks);
    }
    finally {
        await f.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
