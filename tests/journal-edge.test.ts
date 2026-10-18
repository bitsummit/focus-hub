import { createTestDatabase } from './postgres-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOwner } from '../server/auth.ts';
import { Domain } from '../server/domain.ts';
async function fixture() {
    const fixtureDB = await createTestDatabase();
    const db = fixtureDB.db;
    const user = (await createOwner(db, { email: 'journal-edge@example.test', password: 'Fictional-journal-test-password' }));
    const workspace = (await db.one("SELECT id FROM workspaces WHERE owner_user_id=$1", [user.id]))!;
    return { db, close: fixtureDB.close, domain: new Domain(db, { user_id: user.id, workspace_id: String(workspace.id) }) };
}
test('Journal inferred nesting cannot attach to a deleted parent or jump to its older sibling', async () => {
    const { close, domain: d } = (await fixture());
    try {
        const date = '2026-10-16';
        (await d.appendBlock(date, { text: '- [ ] Older sibling', request_id: randomUUID(), revision: 0 }));
        (await d.appendBlock(date, { text: '- [ ] Removed parent', request_id: randomUUID(), revision: 1 }));
        const parent = (await d.snapshot()).tasks.find(t => t.title === 'Removed parent')!;
        (await d.deleteTask(parent.id));
        (await d.appendBlock(date, { text: '- [ ] New child', request_id: randomUUID(), revision: 2, indent_level: 1 }));
        const state = (await d.snapshot());
        assert.equal(state.tasks.find(t => t.title === 'New child')!.parent_task_id, null);
        assert.equal(state.tasks.length, 3);
        assert.ok(state.tasks.find(t => t.id === parent.id)!.deleted_at);
    }
    finally {
        await close();
    }
});
test('Journal headings isolate parent-task context while preserving live nesting in the current section', async () => {
    const { close, domain: d } = (await fixture());
    try {
        const date = '2026-10-16';
        (await d.appendBlock(date, { text: '# Primera sección', request_id: randomUUID(), revision: 0 }));
        (await d.appendBlock(date, { text: '- [ ] Parent in first section', request_id: randomUUID(), revision: 1 }));
        (await d.appendBlock(date, { text: '# Segunda sección', request_id: randomUUID(), revision: 2 }));
        (await d.appendBlock(date, { text: '- [ ] First task in second section', request_id: randomUUID(), revision: 3, indent_level: 1 }));
        const first = (await d.snapshot()).tasks.find(t => t.title === 'First task in second section')!;
        assert.equal(first.parent_task_id, null);
        (await d.appendBlock(date, { text: '- [ ] Real child', request_id: randomUUID(), revision: 4, indent_level: 2 }));
        assert.equal((await d.snapshot()).tasks.find(t => t.title === 'Real child')!.parent_task_id, first.id);
    }
    finally {
        await close();
    }
});
