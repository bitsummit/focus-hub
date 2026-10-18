import { createTestDatabase } from './postgres-fixture.ts';
import type { Database } from '../server/db.ts';
import { openDatabase as openLegacy } from '../server/legacy-sqlite.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { openDatabase } from '../server/db.ts';
import { createOwner } from '../server/auth.ts';
import { Domain } from '../server/domain.ts';
import { createApp } from '../server/app.ts';
import { backupDatabase, verifyDatabase, restoreDatabase, RECOVERY_TABLES } from '../server/recovery.ts';
const password = 'Fictional-Language-Test-2026!';
function rows(db: DatabaseSync, omitLanguage = false) {
    return Object.fromEntries(RECOVERY_TABLES.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => {
            if (table === 'users' && omitLanguage) {
                const { language, ...legacy } = row;
                return legacy;
            }
            return { ...row };
        })]));
}
async function pgRows(db: Database, omitLanguage = false): Promise<Record<string, any[]>> {
    return Object.fromEntries(await Promise.all(RECOVERY_TABLES.map(async (table) => [table, (await db.all(`SELECT * FROM ${table} ORDER BY ${table === 'workspace_members' ? 'workspace_id,user_id' : table === 'idempotency_keys' ? 'workspace_id,request_id' : table === 'sessions' ? 'id_hash' : 'id'}`)).map(row => {
            const {storage_order,...original}=row; row=original;
            if (table === 'users' && omitLanguage) {
                const { language, ...legacy } = row;
                return legacy;
            }
            return { ...row };
        })])));
}
async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'focus-language-'));
    const fixtureDB = await createTestDatabase();
    const path = fixtureDB.url, db = fixtureDB.db;
    const a = (await createOwner(db, { email: 'language-a@example.test', password })), b = (await createOwner(db, { email: 'language-b@example.test', password }));
    const context = async (id: string) => ({ user_id: id, workspace_id: String((await db.one("SELECT workspace_id FROM workspace_members WHERE user_id=$1", [id]))!.workspace_id) });
    const domain = new Domain(db, await context(a.id));
    const goal = (await domain.createEntity('goals', { title: 'Meta ficticia' })), project = (await domain.createEntity('projects', { name: 'Proyecto ficticio', goal_id: goal.id }));
    const milestone = (await domain.createEntity('milestones', { title: 'Hito ficticio', project_id: project.id, goal_id: goal.id }));
    (await domain.updateEntity('milestones', milestone.id, { status: 'achieved' }));
    const task = (await domain.capture({ text: 'Tarea ficticia de idioma', request_id: randomUUID(), project_id: project.id, journal_date: '2026-10-16' }));
    (await domain.updateTask(task.id, { status: 'completed' }));
    (await domain.updateTask(task.id, { status: 'pending' }));
    (await domain.setFocus('weekly', '2026-10-12', [task.id]));
    const deleted = (await domain.capture({ text: 'Borrada ficticia', request_id: randomUUID() }));
    (await domain.deleteTask(deleted.id));
    (await db.run("UPDATE users SET timezone='America/New_York',theme='dark',preferred_task_view='table',week_start_day=0 WHERE id=$1", [a.id]));
    return { dir, path, schema: fixtureDB.schema, db, a, b, context, domain, async close() { await fixtureDB.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function legacyCopy(db: Database, path: string) {
    const legacy = new DatabaseSync(path);
    legacy.exec(readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
    legacy.exec('PRAGMA foreign_keys=OFF; BEGIN');
    try {
        for (const [table, records] of Object.entries(await pgRows(db, true)))
            for (const record of records) {
                const keys = Object.keys(record);
                legacy.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => record[key]));
            }
        legacy.exec('COMMIT');
    }
    finally {
        legacy.close();
    }
}
test('language migration: complete legacy graph, historical dates and preferences survive additive reopen', async () => {
    const f = (await fixture());
    try {
        const path = join(f.dir, 'legacy.sqlite');
        await legacyCopy(f.db, path);
        const original = new DatabaseSync(path, { readOnly: true });
        const before = rows(original);
        original.close();
        assert.equal(verifyDatabase(path).schemaVersion, 1);
        const migrated = openLegacy(path);
        try {
            assert.deepEqual(rows(migrated, true), before);
            assert.equal(migrated.prepare("SELECT language FROM users WHERE id=?").get(f.a.id)!.language, 'es');
            assert.equal(migrated.prepare("PRAGMA foreign_key_check").all().length, 0);
        }
        finally {
            migrated.close();
        }
        assert.equal(verifyDatabase(path).schemaVersion, 2);
        const again = openLegacy(path);
        try {
            assert.deepEqual(rows(again, true), before);
            assert.equal(again.prepare("PRAGMA table_info(users)").all().filter(column => column.name === 'language').length, 1);
        }
        finally {
            again.close();
        }
    }
    finally {
        (await f.close());
    }
});
test('language migration: database constraint admits only es/en and preserves accounts on invalid update', async () => {
    const f = (await fixture());
    try {
        for (const value of ['en', 'es']) {
            (await f.db.run("UPDATE users SET language=$1 WHERE id=$2", [value, f.a.id]));
            assert.equal((await f.db.one("SELECT language FROM users WHERE id=$1", [f.a.id]))!.language, value);
        }
        for (const value of ['fr', 'EN', '', null])
            await assert.rejects(async () => (await f.db.run("UPDATE users SET language=$1 WHERE id=$2", [value, f.a.id])));
        assert.equal((await f.db.one("SELECT language FROM users WHERE id=$1", [f.a.id]))!.language, 'es');
        assert.equal((await f.db.one("SELECT language FROM users WHERE id=$1", [f.b.id]))!.language, 'es');
    }
    finally {
        (await f.close());
    }
});
test('language migration: legacy backup/restore stays readonly and upgrades only on normal database open', async () => {
    const f = (await fixture()), previous = process.cwd();
    try {
        process.chdir(f.dir);
        const source = join(f.dir, 'legacy.sqlite'), backup = join(f.dir, 'legacy-backup.sqlite'), restored = join(f.dir, 'legacy-restored.sqlite');
        await legacyCopy(f.db, source);
        assert.equal((await backupDatabase(source, backup)).schemaVersion, 1);
        assert.equal((await restoreDatabase(backup, restored)).schemaVersion, 1);
        assert.equal(verifyDatabase(source).schemaVersion, 1);
        assert.equal(verifyDatabase(backup).schemaVersion, 1);
        const db = openLegacy(restored);
        try {
            assert.equal(db.prepare("SELECT language FROM users WHERE id=?").get(f.a.id)!.language, 'es');
            const normalize = (value: Record<string, any[]>) => Object.fromEntries(Object.entries(value).map(([table, rs]) => [table, rs.map(row => JSON.stringify(row, Object.keys(row).sort())).sort()]));
            assert.deepEqual(normalize(rows(db, true)), normalize(await pgRows(f.db, true)));
        }
        finally {
            (await db.close());
        }
        assert.equal(verifyDatabase(restored).schemaVersion, 2);
    }
    finally {
        process.chdir(previous);
        (await f.close());
    }
});
test('language preference API: authorized per-user persistence, validation and exported preference', async () => {
    const f = (await fixture());
    const server = createApp(f.db).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw Error('Missing address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
        const challenge = await fetch(base + '/api/session/challenge'), { loginToken } = await challenge.json(), cookie = challenge.headers.get('set-cookie')!.split(';')[0];
        const login = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie, 'X-Login-CSRF': loginToken }, body: JSON.stringify({ email: 'language-a@example.test', password }) });
        assert.equal(login.status, 200);
        const session = await login.json(), sessionCookie = login.headers.get('set-cookie')!.split(';')[0];
        const headers = { 'Content-Type': 'application/json', Origin: base, Cookie: sessionCookie, 'X-CSRF-Token': session.csrfToken };
        const response = await fetch(base + '/api/preferences', { method: 'PATCH', headers, body: JSON.stringify({ language: 'en' }) });
        assert.equal(response.status, 200);
        assert.equal((await f.db.one("SELECT language FROM users WHERE id=$1", [f.a.id]))!.language, 'en');
        assert.equal((await f.db.one("SELECT language FROM users WHERE id=$1", [f.b.id]))!.language, 'es');
        const snapshot = await (await fetch(base + '/api/state', { headers })).json();
        assert.equal(snapshot.user.language, 'en');
        const exported = await (await fetch(base + '/api/export', { headers })).json();
        assert.equal(exported.user.language, 'en');
        for (const language of ['fr', 'EN', '', null, 3])
            assert.equal((await fetch(base + '/api/preferences', { method: 'PATCH', headers, body: JSON.stringify({ language }) })).status, 400);
        assert.equal((await fetch(base + '/api/preferences', { method: 'PATCH', headers, body: JSON.stringify({ language: 'es', user_id: f.b.id }) })).status, 400);
        assert.equal((await f.db.one("SELECT language FROM users WHERE id=$1", [f.a.id]))!.language, 'en');
        const second = (await openDatabase(f.path, { schema: f.schema }));
        try {
            assert.equal((await second.one("SELECT language FROM users WHERE id=$1", [f.a.id]))!.language, 'en');
        }
        finally {
            (await second.close());
        }
    }
    finally {
        await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
        (await f.close());
    }
});
