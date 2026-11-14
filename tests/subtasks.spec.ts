import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Snapshot, Task } from '../shared/contracts.ts';

const origin = 'http://127.0.0.1:4173';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel(/correo/i).fill('browser@example.test');
  await page.getByLabel(/contraseña/i).fill('Browser-QA-fictional-2026!');
  await page.getByRole('button', { name: /entrar|iniciar sesión/i }).click();
  await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible();
}

async function mutate(request: APIRequestContext, path: string, data: unknown, method = 'POST'): Promise<Snapshot> {
  const session = await (await request.get('/api/session')).json();
  const response = await request.fetch(path, {
    method, data, headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function capture(request: APIRequestContext, title: string, parentId?: string): Promise<Task> {
  const state = await mutate(request, '/api/tasks', {
    text: title, request_id: randomUUID(), ...(parentId ? { parent_task_id: parentId } : {}),
  });
  return state.tasks.find(task => task.title === title)!;
}

for (const width of [1440, 390]) {
  test(`subtasks stay inside their parent in table and Kanban at ${width}px, with durable independent completion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    await page.goto('/tasks');
    const prefix = `Subtareas QA ${randomUUID().slice(0, 8)}`;
    const parent = await capture(page.request, `${prefix} entrega`);
    const child = await capture(page.request, `${prefix} preparar materiales con un título suficientemente largo para comprobar su ajuste en móvil`, parent.id);
    const done = await capture(page.request, `${prefix} revisar borrador`, parent.id);
    await mutate(page.request, `/api/tasks/${child.id}`, { status: 'blocked', priority: 'high' }, 'PATCH');
    await mutate(page.request, `/api/tasks/${done.id}`, { status: 'completed' }, 'PATCH');
    await page.reload();
    const priorityFilter = page.getByLabel('Filtrar por prioridad', { exact: true });

    for (const view of ['Tabla', 'Kanban']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      const parentTitle = page.getByRole('button', { name: parent.title, exact: true });
      await expect(parentTitle).toBeVisible();
      const block = parentTitle.locator(width >= 768 && view === 'Tabla' ? 'xpath=ancestor::tr[1]' : 'xpath=ancestor::article[1]');
      const children = block.getByRole('list', { name: `Subtareas: ${parent.title}`, exact: true });
      await expect(children).toBeVisible();
      for (const task of [child, done]) {
        await expect(children.getByRole('button', { name: task.title, exact: true })).toBeVisible();
        // One rendered title globally: children must not also become standalone rows/cards.
        await expect(page.getByRole('button', { name: task.title, exact: true })).toHaveCount(1);
      }
      await expect(children.getByRole('checkbox', { name: `Reabrir ${done.title}`, exact: true })).toHaveAttribute('aria-checked', 'true');
      const complete = children.getByRole('checkbox', { name: `Completar ${child.title}`, exact: true });
      await complete.focus();
      await page.keyboard.press('Space');
      await expect(children.getByRole('checkbox', { name: `Reabrir ${child.title}`, exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(block.getByRole('checkbox', { name: `Completar ${parent.title}`, exact: true })).toHaveAttribute('aria-checked', 'false');
      await page.reload();
      // View preferences are separate from task persistence; restore this test's chosen view.
      await page.getByRole('button', { name: view, exact: true }).click();
      await expect(children.getByRole('checkbox', { name: `Reabrir ${child.title}`, exact: true })).toBeVisible();
      const persisted: Snapshot = await (await page.request.get('/api/state')).json();
      expect(persisted.tasks.find(task => task.id === child.id)?.completed_at).toBeTruthy();
      expect(persisted.tasks.find(task => task.id === parent.id)?.status).toBe('pending');
      expect(persisted.tasks.filter(task => task.id === child.id)).toHaveLength(1);
      await children.getByRole('checkbox', { name: `Reabrir ${child.title}`, exact: true }).click();
      await expect(children.getByRole('checkbox', { name: `Completar ${child.title}`, exact: true })).toHaveAttribute('aria-checked', 'false');
      await children.getByRole('button', { name: child.title, exact: true }).click();
      await expect(page.getByRole('dialog').getByLabel('Título', { exact: true })).toHaveValue(child.title);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (width < 768) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      }
      await page.screenshot({ path: testInfo.outputPath(`subtasks-${width}-${view.toLowerCase()}.png`), fullPage: true });
      // A matching child must remain discoverable when its normal-priority parent is filtered out.
      await priorityFilter.selectOption('high');
      await expect(parentTitle).toHaveCount(0);
      const standalone = page.getByRole('button', { name: child.title, exact: false });
      await expect(standalone).toBeVisible();
      await expect(standalone).toHaveCount(1);
      await priorityFilter.selectOption('');
    }
    await page.reload();
    const final: Snapshot = await (await page.request.get('/api/state')).json();
    expect(final.tasks.find(task => task.id === child.id)?.status).toBe('pending');
    expect(final.tasks.find(task => task.id === done.id)?.status).toBe('completed');
    expect(final.tasks.find(task => task.id === parent.id)?.status).toBe('pending');
    expect(final.events.filter(event => event.task_id === child.id && event.event_type === 'completed')).toHaveLength(2);
    expect(final.events.filter(event => event.task_id === child.id && event.event_type === 'reopened')).toHaveLength(2);
    expect(final.events.filter(event => event.task_id === parent.id && event.event_type === 'completed')).toHaveLength(0);
  });
}
