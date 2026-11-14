import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { type Database, transaction } from './db.ts';
import { addDays, localDate, periodBounds, periodStart } from './calendar.ts';
import { STATUSES, PRIORITIES, type AuthContext, type CaptureInput, type JournalAppend, type Snapshot, type Analytics, type Task, type User } from '../shared/contracts.ts';
type Row = Record<string, any>;
type EntityKind = 'projects' | 'goals' | 'milestones';
const tables = { projects: 'projects', goals: 'strategic_goals', milestones: 'milestones' } as const;
export class DomainError extends Error {
    constructor(message: string, public status = 400, public code = 'VALIDATION_ERROR') {
        super(message);
    }
}
function fail(message: string, status = 400, code = 'VALIDATION_ERROR'): never {
    throw new DomainError(message, status, code);
}
function object(value: unknown): Row {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('Se esperaba un objeto.');
    return value as Row;
}
function text(value: unknown, name: string, max = 500, empty = false): string {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0'))
        fail(`${name}: texto inválido (máximo ${max}).`);
    return value.trim();
}
function enumValue(value: unknown, allowed: readonly string[], name: string): string {
    if (typeof value !== 'string' || !allowed.includes(value))
        fail(`${name}: valor inválido.`);
    return value;
}
function integer(value: unknown, name: string, min = 0, max = 8): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
        fail(`${name}: número inválido.`);
    return value;
}
function date(value: unknown, name = 'Fecha'): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        fail(`${name}: usa AAAA-MM-DD.`);
    try {
        if (Temporal.PlainDate.from(value).toString() !== value)
            fail(`${name}: fecha inválida.`);
    }
    catch {
        fail(`${name}: fecha inválida.`);
    }
    return value;
}
function optionalDate(value: unknown, name: string): string | null {
    if (value === null || value === '')
        return null;
    if (typeof value !== 'string')
        fail(`${name}: fecha inválida.`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return date(value, name);
    try {
        return Temporal.Instant.from(value).toString({ smallestUnit: 'millisecond' });
    }
    catch {
        fail(`${name}: fecha inválida.`);
    }
}
function allowed(input: Row, keys: string[]): void {
    for (const key of Object.keys(input))
        if (!keys.includes(key))
            fail(`Campo no permitido: ${key}.`);
}
const now = () => new Date().toISOString();
const isOpen = (status: string) => status !== 'completed' && status !== 'cancelled';
/** Domain SQL is workspace-scoped; auth/password/session storage stays outside this boundary. */
export class Domain {
    constructor(private db: Database, private context: AuthContext) {
    }
    // storage_order replaces SQLite rowid only internally, never in API/event JSON.
    private async all(sql: string, ...params: unknown[]): Promise<Row[]> {
        return (await this.db.all(sql, params)).map(({ storage_order: _order, ...row }) => row);
    }
    private async one(sql: string, ...params: unknown[]): Promise<Row | undefined> {
        const row = await this.db.one(sql, params);
        if (!row)
            return undefined;
        const { storage_order: _order, ...result } = row;
        return result;
    }
    private async run(sql: string, ...params: unknown[]) {
        return this.db.run(sql, params);
    }
    // Acquire this lock before any entity reads: PostgreSQL must serialize the
    // read/validate/write sequence that SQLite previously serialized for us.
    // Shared locks keep snapshots coherent while allowing concurrent readers.
    private async access<T>(write: boolean, action: () => Promise<T>): Promise<T> {
        return await transaction(this.db, async () => {
            const membership = await this.db.one(`SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2 FOR ${write ? 'UPDATE' : 'SHARE'} OF w`, [this.ws, this.uid]);
            if (!membership)
                fail('Espacio no disponible.', 403, 'FORBIDDEN');
            return await action();
        });
    }
    private get ws() {
        return this.context.workspace_id;
    }
    private get uid() {
        return this.context.user_id;
    }
    private async user(): Promise<User> {
        return await this.one('SELECT id,email,display_name,timezone,theme,preferred_task_view,week_start_day,language,created_at FROM users WHERE id=$1', this.uid) as User;
    }
    private async scoped(table: string, id: unknown, extra = ''): Promise<Row> {
        const key = text(id, 'Identificador', 200);
        const row = await this.one(`SELECT * FROM ${table} WHERE id=$1 AND workspace_id=$2 ${extra}`, key, this.ws);
        if (!row)
            fail('Registro no encontrado.', 404, 'NOT_FOUND');
        return row;
    }
    private async task(id: unknown, includeDeleted = false): Promise<Task> {
        const row = await this.scoped('tasks', id, includeDeleted ? '' : 'AND deleted_at IS NULL');
        return { ...row, tags: JSON.parse(row.tags) } as Task;
    }
    private async reference(table: string, id: unknown): Promise<string | null> {
        if (id === null || id === '')
            return null;
        const row = table === 'tasks' ? await this.task(id) : await this.scoped(table, id);
        return row.id;
    }
    private async insert(table: string, input: Row): Promise<void> {
        const fields = Object.keys(input);
        await this.run(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(',')})`, ...fields.map(k => input[k] as unknown));
    }
    private async update(table: string, id: string, changes: Row): Promise<void> {
        const fields = Object.keys(changes);
        if (!fields.length)
            return;
        await this.run(`UPDATE ${table} SET ${fields.map((k, index) => `${k}=$${index + 1}`).join(',')} WHERE id=$${fields.length + 1} AND workspace_id=$${fields.length + 2}`, ...fields.map(k => changes[k] as unknown), id, this.ws);
    }
    private async event(taskId: string, type: string, from: unknown, to: unknown, time = now()): Promise<void> {
        await this.insert('task_events', { id: randomUUID(), workspace_id: this.ws, task_id: taskId, actor_user_id: this.uid, event_type: type, from_value_json: from === undefined ? null : JSON.stringify(from), to_value_json: to === undefined ? null : JSON.stringify(to), occurred_at: time });
    }
    private async idempotent<T>(kind: string, key: unknown, payload: unknown, action: () => Promise<T>): Promise<T> {
        const request = text(key, 'Identificador de solicitud', 160);
        const fingerprint = JSON.stringify({ kind, user_id: this.uid, payload });
        const previous = await this.one('SELECT result_json FROM idempotency_keys WHERE workspace_id=$1 AND request_id=$2', this.ws, request);
        if (previous) {
            const cached = JSON.parse(previous.result_json);
            if (cached.fingerprint !== fingerprint)
                fail('La solicitud ya se utilizó con otro contenido.', 409, 'IDEMPOTENCY_CONFLICT');
            return cached.result as T;
        }
        const result = await action();
        await this.insert('idempotency_keys', { workspace_id: this.ws, request_id: request, result_json: JSON.stringify({ fingerprint, result }), created_at: now() });
        return result;
    }
    async snapshot(): Promise<Snapshot> {
        return this.access(false, async () => {
            const taskRows = (await this.all('SELECT * FROM tasks WHERE workspace_id=$1 ORDER BY sort_order,created_at,id', this.ws)).map(t => ({ ...t, tags: JSON.parse(t.tags) }));
            return {
                user: await this.user(),
                workspace: await this.one('SELECT * FROM workspaces WHERE id=$1', this.ws),
                tasks: taskRows,
                projects: await this.all('SELECT * FROM projects WHERE workspace_id=$1 ORDER BY sort_order,created_at,storage_order', this.ws),
                goals: await this.all('SELECT * FROM strategic_goals WHERE workspace_id=$1 ORDER BY sort_order,created_at,storage_order', this.ws),
                milestones: await this.all('SELECT * FROM milestones WHERE workspace_id=$1 ORDER BY sort_order,created_at,storage_order', this.ws),
                events: await this.all('SELECT * FROM task_events WHERE workspace_id=$1 ORDER BY occurred_at,storage_order', this.ws),
                journals: await this.all('SELECT * FROM journal_entries WHERE workspace_id=$1 AND author_user_id=$2 ORDER BY entry_date', this.ws, this.uid),
                blocks: await this.all('SELECT b.* FROM journal_blocks b JOIN journal_entries j ON j.id=b.journal_entry_id AND j.workspace_id=b.workspace_id WHERE b.workspace_id=$1 AND j.author_user_id=$2 ORDER BY b.sort_order,b.created_at,b.storage_order', this.ws, this.uid),
                focus: await this.all('SELECT * FROM focus_items WHERE workspace_id=$1 AND user_id=$2 ORDER BY period_start,sort_order,storage_order', this.ws, this.uid)
            } as Snapshot;
        });
    }
    private async parsedCapture(raw: string, projectId: string | null): Promise<{
        title: string;
        priority: string;
        project_id: string | null;
    }> {
        let title = text(raw, 'Tarea', 2000).replace(/^\s*-\s*\[\s*\]\s*/, '');
        let priority = 'normal';
        if (title.startsWith('!!')) {
            priority = 'critical';
            title = title.slice(2).trim();
        }
        else if (title.startsWith('!')) {
            priority = 'high';
            title = title.slice(1).trim();
        }
        const matches = [...title.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)];
        for (const match of matches) {
            const project = await this.one('SELECT id FROM projects WHERE workspace_id=$1 AND (focus_ascii_fold(slug)=focus_ascii_fold($2) OR focus_ascii_fold(name)=focus_ascii_fold($3)) ORDER BY storage_order LIMIT 1', this.ws, match[1], match[1]);
            if (project) {
                projectId = project.id;
                title = title.replace(match[0], ' ').trim();
            }
        }
        return { title: text(title, 'Título', 500), priority, project_id: projectId };
    }
    private async createTask(input: CaptureInput, projectContext: string | null = null, parentContext: string | null = null): Promise<Task> {
        const parsed = await this.parsedCapture(input.text, input.project_id === undefined ? projectContext : await this.reference('projects', input.project_id));
        if (input.priority !== undefined)
            parsed.priority = enumValue(input.priority, PRIORITIES, 'Prioridad');
        const parent = await this.reference('tasks', input.parent_task_id === undefined ? parentContext : input.parent_task_id);
        const time = now(), id = randomUUID();
        await this.insert('tasks', { id, workspace_id: this.ws, ...parsed, parent_task_id: parent, created_by_user_id: this.uid, created_at: time, updated_at: time });
        const task = await this.task(id);
        await this.event(id, 'created', undefined, task, time);
        return task;
    }
    async capture(input: CaptureInput): Promise<Task> {
        return this.access(true, async () => {
            const value = object(input);
            allowed(value, ['text', 'request_id', 'project_id', 'parent_task_id', 'journal_date', 'indent_level', 'priority']);
            text(value.text, 'Tarea', 2000);
            return await this.idempotent('capture', value.request_id, value, async () => {
                const task = await this.createTask(input);
                if (input.journal_date) {
                    const entry = await this.entry(date(input.journal_date));
                    await this.newBlock(entry, 'task_reference', '', task.id, input.indent_level === undefined ? 0 : integer(input.indent_level, 'Sangría'));
                    await this.bump(entry);
                }
                return task;
            });
        });
    }
    async updateTask(id: string, input: unknown): Promise<Task> {
        return this.access(true, async () => {
            const value = object(input);
            allowed(value, ['title', 'description', 'status', 'priority', 'project_id', 'parent_task_id', 'due_at', 'waiting_on', 'follow_up_at', 'tags', 'sort_order']);
            const original = await this.task(id);
            const changes: Row = {};
            for (const key of ['title', 'description', 'waiting_on'])
                if (key in value)
                    changes[key] = text(value[key], key, key === 'description' ? 20000 : 500, key !== 'title');
            if ('status' in value)
                changes.status = enumValue(value.status, STATUSES, 'Estado');
            if ('priority' in value)
                changes.priority = enumValue(value.priority, PRIORITIES, 'Prioridad');
            if ('project_id' in value)
                changes.project_id = await this.reference('projects', value.project_id);
            if ('parent_task_id' in value) {
                changes.parent_task_id = await this.reference('tasks', value.parent_task_id);
                let cursor = changes.parent_task_id;
                const visited = new Set<string>([id]);
                while (cursor) {
                    if (visited.has(cursor))
                        fail('La subtarea no puede formar un ciclo.');
                    visited.add(cursor);
                    cursor = (await this.task(cursor)).parent_task_id;
                }
            }
            for (const key of ['due_at', 'follow_up_at'])
                if (key in value)
                    changes[key] = optionalDate(value[key], key);
            if ('sort_order' in value) {
                if (typeof value.sort_order !== 'number' || !Number.isFinite(value.sort_order) || Math.abs(value.sort_order) > 1e12)
                    fail('Orden inválido.');
                changes.sort_order = value.sort_order;
            }
            if ('tags' in value) {
                if (!Array.isArray(value.tags) || value.tags.length > 30)
                    fail('Etiquetas inválidas.');
                changes.tags = JSON.stringify([...new Set(value.tags.map((v: unknown) => text(v, 'Etiqueta', 60)))]);
            }
            const time = now();
            for (const key of ['title', 'priority', 'project_id', 'parent_task_id', 'description', 'waiting_on', 'due_at', 'follow_up_at', 'tags'])
                if (key in changes) {
                    const before = key === 'tags' ? JSON.stringify(original.tags) : (original as unknown as Row)[key];
                    if (before !== changes[key])
                        await this.event(id, `${key.replace('_id', '')}_changed`, key === 'tags' ? original.tags : before, key === 'tags' ? JSON.parse(changes[key]) : changes[key], time);
                }
            if (changes.status !== undefined && changes.status !== original.status) {
                await this.event(id, 'status_changed', original.status, changes.status, time);
                if (original.status === 'completed')
                    await this.event(id, 'reopened', original.status, changes.status, time);
                if (changes.status === 'completed') {
                    changes.completed_at = time;
                    await this.event(id, 'completed', original.status, { status: 'completed', priority: changes.priority ?? original.priority, project_id: changes.project_id === undefined ? original.project_id : changes.project_id }, time);
                }
                else
                    changes.completed_at = null;
                if (changes.status === 'cancelled') {
                    changes.cancelled_at = time;
                    await this.event(id, 'cancelled', original.status, 'cancelled', time);
                }
                else
                    changes.cancelled_at = null;
            }
            await this.update('tasks', id, { ...changes, updated_at: time });
            return await this.task(id);
        });
    }
    async deleteTask(id: string): Promise<void> {
        return this.access(true, async () => {
            const task = await this.task(id);
            const time = now();
            await this.update('tasks', id, { deleted_at: time, updated_at: time });
            await this.event(id, 'deleted', task.status, { deleted_at: time }, time);
        });
    }
    private async entityData(kind: EntityKind, input: unknown, creating: boolean): Promise<Row> {
        const value = object(input);
        const keys = kind === 'projects' ? ['name', 'slug', 'description', 'goal_id', 'color', 'icon', 'status', 'target_date', 'sort_order'] : kind === 'goals' ? ['title', 'description', 'period_start', 'period_end', 'status', 'sort_order'] : ['title', 'description', 'project_id', 'goal_id', 'status', 'sort_order'];
        allowed(value, keys);
        const changes: Row = {};
        const titleKey = kind === 'projects' ? 'name' : 'title';
        if (creating || titleKey in value)
            changes[titleKey] = text(value[titleKey], titleKey, 250);
        if ('description' in value)
            changes.description = text(value.description, 'Descripción', 20000, true);
        if ('goal_id' in value)
            changes.goal_id = await this.reference('strategic_goals', value.goal_id);
        if ('project_id' in value)
            changes.project_id = await this.reference('projects', value.project_id);
        if ('status' in value)
            changes.status = enumValue(value.status, kind === 'projects' ? ['active', 'on_hold', 'archived'] : kind === 'goals' ? ['active', 'achieved', 'paused', 'archived'] : ['pending', 'achieved'], 'Estado');
        if ('sort_order' in value) {
            if (typeof value.sort_order !== 'number' || !Number.isFinite(value.sort_order) || Math.abs(value.sort_order) > 1e12)
                fail('Orden inválido.');
            changes.sort_order = value.sort_order;
        }
        for (const key of ['target_date', 'period_start', 'period_end'])
            if (key in value)
                changes[key] = value[key] === null || value[key] === '' ? null : date(value[key]);
        if (kind === 'projects') {
            if ('color' in value) {
                if (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color))
                    fail('Color inválido.');
                changes.color = value.color;
            }
            if ('icon' in value)
                changes.icon = text(value.icon, 'Icono', 50);
            if ('slug' in value || creating) {
                const slug = 'slug' in value ? text(value.slug, 'Código del proyecto', 80) : changes.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `project-${randomUUID().slice(0, 6)}`;
                if (!/^[\p{L}\p{N}_-]+$/u.test(slug))
                    fail('Código de proyecto inválido.');
                changes.slug = slug;
            }
        }
        return changes;
    }
    async createEntity(kind: EntityKind, input: unknown): Promise<Row> {
        return this.access(true, async () => {
            if (!(kind in tables))
                fail('Recurso inválido.');
            const changes = await this.entityData(kind, input, true);
            if (kind === 'projects' && await this.one('SELECT id FROM projects WHERE workspace_id=$1 AND focus_ascii_fold(slug)=focus_ascii_fold($2)', this.ws, changes.slug))
                fail('Ya existe ese código de proyecto.', 409, 'CONFLICT');
            if (kind === 'milestones' && !changes.project_id && !changes.goal_id)
                fail('Asocia el hito a un objetivo o proyecto.');
            if (kind === 'goals' && changes.period_start && changes.period_end && changes.period_start > changes.period_end)
                fail('Periodo inválido.');
            const time = now(), id = randomUUID();
            if (kind === 'milestones')
                changes.achieved_at = changes.status === 'achieved' ? time : null;
            await this.insert(tables[kind], { id, workspace_id: this.ws, ...changes, created_at: time, updated_at: time });
            return await this.scoped(tables[kind], id);
        });
    }
    async updateEntity(kind: EntityKind, id: string, input: unknown): Promise<Row> {
        return this.access(true, async () => {
            if (!(kind in tables))
                fail('Recurso inválido.');
            const original = await this.scoped(tables[kind], id);
            const changes = await this.entityData(kind, input, false);
            const merged = { ...original, ...changes };
            if (kind === 'projects' && changes.slug && await this.one('SELECT id FROM projects WHERE workspace_id=$1 AND focus_ascii_fold(slug)=focus_ascii_fold($2) AND id<>$3', this.ws, changes.slug, id))
                fail('Ya existe ese código de proyecto.', 409, 'CONFLICT');
            if (kind === 'milestones' && !merged.project_id && !merged.goal_id)
                fail('Asocia el hito a un objetivo o proyecto.');
            if (kind === 'goals' && merged.period_start && merged.period_end && merged.period_start > merged.period_end)
                fail('Periodo inválido.');
            const time = now();
            if (kind === 'milestones' && changes.status !== undefined && changes.status !== original.status)
                changes.achieved_at = changes.status === 'achieved' ? time : null;
            await this.update(tables[kind], id, { ...changes, updated_at: time });
            return await this.scoped(tables[kind], id);
        });
    }
    private async entry(entryDate: string): Promise<Row> {
        let entry = await this.one('SELECT * FROM journal_entries WHERE workspace_id=$1 AND author_user_id=$2 AND entry_date=$3', this.ws, this.uid, entryDate);
        if (!entry) {
            const time = now();
            const id = randomUUID();
            await this.insert('journal_entries', { id, workspace_id: this.ws, author_user_id: this.uid, entry_date: entryDate, created_at: time, updated_at: time });
            entry = await this.scoped('journal_entries', id);
        }
        return entry;
    }
    private async bump(entry: Row): Promise<void> {
        await this.update('journal_entries', entry.id, { revision: entry.revision + 1, updated_at: now() });
    }
    private revision(entry: Row, value: unknown): void {
        if (entry.revision !== integer(value, 'Versión', 0, 1e9))
            fail('El diario ha cambiado. Actualízalo antes de guardar.', 409, 'REVISION_CONFLICT');
    }
    private async newBlock(entry: Row, type: string, content: string, taskId: string | null, indent: number): Promise<Row> {
        const time = now(), id = randomUUID();
        const order = ((await this.one('SELECT MAX(sort_order) AS value FROM journal_blocks WHERE workspace_id=$1 AND journal_entry_id=$2', this.ws, entry.id))?.value ?? -1) + 1;
        await this.insert('journal_blocks', { id, workspace_id: this.ws, journal_entry_id: entry.id, block_type: type, text_content: content, task_id: taskId, indent_level: indent, sort_order: order, created_at: time, updated_at: time });
        return await this.scoped('journal_blocks', id);
    }
    async appendBlock(entryDate: string, input: JournalAppend): Promise<Row> {
        return this.access(true, async () => {
            date(entryDate);
            const value = object(input);
            allowed(value, ['text', 'request_id', 'revision', 'indent_level', 'task_id']);
            text(value.text, 'Texto del diario', 20000, true);
            return await this.idempotent('journal', value.request_id, { date: entryDate, ...value }, async () => {
                const entry = await this.entry(entryDate);
                this.revision(entry, value.revision);
                let indent = value.indent_level === undefined ? Math.min(8, Math.floor((value.text.match(/^ */)?.[0].length ?? 0) / 2)) : integer(value.indent_level, 'Sangría');
                const raw = value.text.trim();
                let type = 'paragraph', content = raw, taskId: string | null = null;
                if (value.task_id) {
                    taskId = (await this.task(value.task_id)).id;
                    type = 'task_reference';
                    content = '';
                }
                else if (/^-\s*\[\s*\]\s*/.test(raw)) {
                    const blocks = await this.all('SELECT * FROM journal_blocks WHERE workspace_id=$1 AND journal_entry_id=$2 ORDER BY sort_order DESC,storage_order DESC', this.ws, entry.id);
                    const heading = blocks.find(b => b.block_type === 'heading');
                    const headingText = heading?.text_content?.replace(/^#+\s*/, '').trim();
                    const project = headingText ? await this.one('SELECT id FROM projects WHERE workspace_id=$1 AND (focus_ascii_fold(slug)=focus_ascii_fold($2) OR focus_ascii_fold(name)=focus_ascii_fold($3)) ORDER BY storage_order LIMIT 1', this.ws, headingText, headingText) : undefined;
                    // A heading ends the nesting context. A removed parent cannot silently
                    // redirect its next child to an older, unrelated sibling.
                    let parentId: string | null = null;
                    if (indent > 0)
                        for (const block of blocks) {
                            if (block.block_type === 'heading')
                                break;
                            if (block.block_type === 'task_reference' && block.indent_level < indent) {
                                const candidate = await this.one('SELECT id FROM tasks WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL', block.task_id, this.ws);
                                parentId = candidate?.id ?? null;
                                break;
                            }
                        }
                    const task = await this.createTask({ text: raw, request_id: value.request_id }, project?.id ?? null, parentId);
                    taskId = task.id;
                    type = 'task_reference';
                    content = '';
                }
                else if (/^#{1,6}\s+/.test(raw)) {
                    type = 'heading';
                    content = raw.replace(/^#{1,6}\s+/, '');
                    indent = 0;
                }
                else if (/^[-*]\s+/.test(raw)) {
                    type = 'bullet';
                    content = raw.replace(/^[-*]\s+/, '');
                }
                const block = await this.newBlock(entry, type, content, taskId, indent);
                await this.bump(entry);
                return block;
            });
        });
    }
    private async ownBlock(id: string): Promise<{
        block: Row;
        entry: Row;
    }> {
        const block = await this.scoped('journal_blocks', id);
        const entry = await this.scoped('journal_entries', block.journal_entry_id);
        if (entry.author_user_id !== this.uid)
            fail('Registro no encontrado.', 404, 'NOT_FOUND');
        return { block, entry };
    }
    async updateBlock(id: string, input: unknown): Promise<Row> {
        return this.access(true, async () => {
            const value = object(input);
            allowed(value, ['revision', 'text_content', 'indent_level', 'sort_order']);
            const { block, entry } = await this.ownBlock(id);
            this.revision(entry, value.revision);
            const changes: Row = {};
            if ('text_content' in value) {
                if (block.block_type === 'task_reference')
                    fail('Edita la tarea vinculada desde su registro.');
                changes.text_content = text(value.text_content, 'Texto', 20000, true);
            }
            if ('indent_level' in value)
                changes.indent_level = integer(value.indent_level, 'Sangría');
            if ('sort_order' in value) {
                if (typeof value.sort_order !== 'number' || !Number.isFinite(value.sort_order))
                    fail('Orden inválido.');
                changes.sort_order = value.sort_order;
            }
            await this.update('journal_blocks', id, { ...changes, updated_at: now() });
            await this.bump(entry);
            return await this.scoped('journal_blocks', id);
        });
    }
    async deleteBlock(id: string, revision: number): Promise<void> {
        return this.access(true, async () => {
            const { entry } = await this.ownBlock(id);
            this.revision(entry, revision);
            await this.run('DELETE FROM journal_blocks WHERE id=$1 AND workspace_id=$2', id, this.ws);
            await this.bump(entry);
        });
    }
    async setFocus(type: string, entryDate: string, taskIds: unknown): Promise<void> {
        return this.access(true, async () => {
            enumValue(type, ['daily', 'weekly'], 'Periodo');
            date(entryDate);
            if (periodStart(entryDate, type as 'daily' | 'weekly', (await this.user()).week_start_day) !== entryDate)
                fail('La semana debe comenzar en el día configurado.');
            if (!Array.isArray(taskIds) || taskIds.length > (type === 'daily' ? 3 : 5) || new Set(taskIds).size !== taskIds.length)
                fail('Elige hasta 3 tareas diarias o 5 semanales, sin duplicados.');
            const tasks: Row[] = [];
            for (const id of taskIds) tasks.push(await this.task(id));
            const existing = new Set((await this.all('SELECT task_id FROM focus_items WHERE workspace_id=$1 AND user_id=$2 AND period_type=$3 AND period_start=$4', this.ws, this.uid, type, entryDate)).map(item => item.task_id));
            for (const task of tasks)
                if (!isOpen(task.status) && !existing.has(task.id))
                    fail('Selecciona tareas abiertas para el foco.');
            await this.run('DELETE FROM focus_items WHERE workspace_id=$1 AND user_id=$2 AND period_type=$3 AND period_start=$4', this.ws, this.uid, type, entryDate);
            for (const [index, task] of tasks.entries())
                await this.insert('focus_items', { id: randomUUID(), workspace_id: this.ws, user_id: this.uid, task_id: task.id, period_type: type, period_start: entryDate, sort_order: index, created_at: now() });
        });
    }
    async preferences(input: unknown): Promise<User> {
        return this.access(true, async () => {
            const value = object(input);
            allowed(value, ['display_name', 'timezone', 'theme', 'preferred_task_view', 'week_start_day', 'language']);
            const changes: Row = {};
            if ('display_name' in value)
                changes.display_name = text(value.display_name, 'Nombre', 150);
            if ('timezone' in value) {
                const zone = text(value.timezone, 'Zona horaria', 100);
                if (/^[+-]/.test(zone))
                    fail('Selecciona una zona horaria IANA.');
                try {
                    Temporal.Now.zonedDateTimeISO(zone);
                }
                catch {
                    fail('Zona horaria IANA inválida.');
                }
                changes.timezone = zone;
            }
            if ('language' in value)
                changes.language = enumValue(value.language, ['es', 'en'], 'Idioma');
            if ('theme' in value)
                changes.theme = enumValue(value.theme, ['light', 'dark', 'system'], 'Tema');
            if ('preferred_task_view' in value)
                changes.preferred_task_view = enumValue(value.preferred_task_view, ['board', 'table'], 'Vista');
            if ('week_start_day' in value)
                changes.week_start_day = integer(value.week_start_day, 'Inicio de semana', 0, 1);
            const keys = Object.keys(changes);
            if (keys.length)
                await this.run(`UPDATE users SET ${keys.map((k, index) => `${k}=$${index + 1}`).join(',')} WHERE id=$${keys.length + 1}`, ...keys.map(k => changes[k]), this.uid);
            return await this.user();
        });
    }
    async analytics(start: string, end: string): Promise<Analytics> {
        return this.access(false, async () => {
            date(start);
            date(end);
            if (start >= end)
                fail('El fin del periodo debe ser posterior al inicio.');
            let dateCursor = start;
            let days = 0;
            while (dateCursor < end) {
                if (++days > 1098)
                    fail('Selecciona un periodo de hasta tres años.');
                dateCursor = addDays(dateCursor, 1);
            }
            const zone = (await this.user()).timezone;
            const bounds = periodBounds(start, end, zone);
            const events = await this.all('SELECT * FROM task_events WHERE workspace_id=$1 AND occurred_at<$2 ORDER BY occurred_at,storage_order', this.ws, bounds.end);
            const period = events.filter(e => e.occurred_at >= bounds.start);
            const distinct = (type: string) => new Set(period.filter(e => e.event_type === type).map(e => e.task_id)).size;
            const seenCompletions = new Set<string>();
            const achievements: Row[] = [];
            for (const event of period)
                if (event.event_type === 'completed' && !seenCompletions.has(event.task_id)) {
                    seenCompletions.add(event.task_id);
                    achievements.push(event);
                }
            const state = new Map<string, {
                status: string;
                deleted: boolean;
            }>();
            for (const event of events) {
                let current = state.get(event.task_id);
                if (event.event_type === 'created') {
                    let created: Row = {};
                    try {
                        created = JSON.parse(event.to_value_json ?? '{}');
                    }
                    catch {
                    }
                    current = { status: created.status ?? 'pending', deleted: false };
                    state.set(event.task_id, current);
                }
                else if (current) {
                    if (event.event_type === 'status_changed') {
                        try {
                            const next = JSON.parse(event.to_value_json);
                            current.status = typeof next === 'string' ? next : next.status;
                        }
                        catch {
                        }
                    }
                    if (event.event_type === 'deleted')
                        current.deleted = true;
                    if (event.event_type === 'restored')
                        current.deleted = false;
                }
            }
            const distribution: Record<string, number> = Object.fromEntries(STATUSES.map(s => [s, 0]));
            let ending = 0;
            for (const item of state.values())
                if (!item.deleted) {
                    distribution[item.status] = (distribution[item.status] ?? 0) + 1;
                    if (isOpen(item.status))
                        ending++;
                }
            // Convert each relevant timestamp once. Scanning every event for every day
            // blocked the shared event loop for long, otherwise-valid history requests.
            const daily = new Map<string, {
                created: Set<string>;
                completed: Set<string>;
            }>();
            for (const event of period) {
                if (event.event_type !== 'created' && event.event_type !== 'completed')
                    continue;
                const day = localDate(zone, event.occurred_at);
                let counts = daily.get(day);
                if (!counts) {
                    counts = { created: new Set(), completed: new Set() };
                    daily.set(day, counts);
                }
                counts[event.event_type as 'created' | 'completed'].add(event.task_id);
            }
            const series: Analytics['series'] = [];
            for (let day = start; day < end; day = addDays(day, 1)) {
                const counts = daily.get(day);
                series.push({ date: day, created: counts?.created.size ?? 0, completed: counts?.completed.size ?? 0 });
            }
            const created = distinct('created'), completed = distinct('completed');
            return { created, completed, reopened: distinct('reopened'), cancelled: distinct('cancelled'), net: completed - created, ending_backlog: ending, series, achievements: achievements as Analytics['achievements'], milestones: await this.all('SELECT * FROM milestones WHERE workspace_id=$1 AND achieved_at>=$2 AND achieved_at<$3 ORDER BY achieved_at,storage_order', this.ws, bounds.start, bounds.end) as Analytics['milestones'], distribution };
        });
    }
    async exportJSON(): Promise<Row> {
        return this.access(false, async () => {
            const snapshot = await this.snapshot();
            return { schemaVersion: 1, exportedAt: now(), metricDefinitions: { completed: 'Distinct task IDs with verified completion events inside the selected local period; re-completion can count in different periods.', net: 'completed - created', ending_backlog: 'Open, non-deleted tasks reconstructed at the exclusive period end.' }, ...snapshot };
        });
    }
    async exportCSV(): Promise<string> {
        return this.access(false, async () => {
            const fields = ['id', 'workspace_id', 'title', 'description', 'project_id', 'parent_task_id', 'status', 'priority', 'tags', 'due_at', 'waiting_on', 'follow_up_at', 'completed_at', 'cancelled_at', 'deleted_at', 'created_by_user_id', 'created_at', 'updated_at', 'sort_order'];
            const escape = (value: unknown) => {
                let raw = value == null ? '' : Array.isArray(value) ? JSON.stringify(value) : String(value);
                if (/^[\s\u0000-\u0020]*[=+@-]/.test(raw))
                    raw = `'${raw}`;
                return `"${raw.replaceAll('"', '""')}"`;
            };
            return '\uFEFF' + [fields.join(','), ...(await this.snapshot()).tasks.map(task => fields.map(field => escape((task as unknown as Row)[field])).join(','))].join('\r\n') + '\r\n';
        });
    }
}
