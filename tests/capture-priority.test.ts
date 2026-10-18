import { createTestDatabase } from './postgres-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOwner } from '../server/auth.ts';
import { Domain } from '../server/domain.ts';
test('quick capture priority is atomic, validated, idempotent and preserves shorthand defaults', async () => {
    const fixtureDB = await createTestDatabase();
    const db = fixtureDB.db;
    try {
        const user = (await createOwner(db, { email: 'capture-priority@example.test', password: 'Fictional-Priority-2026!' }));
        const ws = String((await db.one("SELECT id FROM workspaces WHERE owner_user_id=$1", [user.id]))!.id);
        const domain = new Domain(db, { user_id: user.id, workspace_id: ws });
        const input = { text: 'Tarea ficticia baja', priority: 'low' as const, request_id: randomUUID() };
        const first = (await domain.capture(input));
        assert.equal(first.priority, 'low');
        assert.equal(first.project_id, null);
        assert.equal((await domain.capture(input)).id, first.id);
        assert.equal((await domain.capture({ text: '!! Prioridad por prefijo', request_id: randomUUID() })).priority, 'critical');
        await assert.rejects(async () => (await domain.capture({ text: 'No debe crearse', request_id: randomUUID(), priority: 'invalid' as any })));
        const state = (await domain.snapshot());
        assert.equal(state.tasks.length, 2);
        assert.equal(state.events.filter(e => e.task_id === first.id && e.event_type === 'created').length, 1);
    }
    finally {
        await fixtureDB.close();
    }
});
