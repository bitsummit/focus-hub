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
async function persisted(page: Page, id: string): Promise<Task> {
  const state: Snapshot = await (await page.request.get('/api/state')).json();
  return state.tasks.find(task => task.id === id)!;
}

for (const width of [1440, 390]) {
  test(`project assignment requires confirmation in table, Kanban and editor at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    const suffix = randomUUID().slice(0, 8);
    const title = `Asignación ficticia ${suffix}`;
    const projectName = `Destino ficticio ${suffix}`;
    const created = await mutate(page.request, '/api/tasks', { text: title, request_id: randomUUID() });
    const task = created.tasks.find(item => item.title === title)!;
    const projects = await mutate(page.request, '/api/projects', { name: projectName });
    const project = projects.projects.find(item => item.name === projectName)!;
    await page.reload();
    await page.getByRole('textbox', { name: 'Buscar tareas', exact: true }).fill(title);
    const confirmation = page.getByRole('alertdialog', { name: 'Cambiar proyecto', exact: true });
    const selector = page.getByLabel(`Proyecto de ${title}`, { exact: true });
    const requests: string[] = [];
    page.on('request', request => {
      if (request.method() === 'PATCH' && request.url().endsWith(`/api/tasks/${task.id}`)) requests.push(request.postData() || '');
    });
    for (const view of width >= 768 ? ['Tabla'] : ['Tabla', 'Kanban']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      await selector.selectOption(project.id);
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toContainText(projectName);
      if (view === 'Tabla') await page.screenshot({ path: testInfo.outputPath(`project-confirmation-${width}.png`) });
      expect((await persisted(page, task.id)).project_id).toBeNull();
      const beforeCancel = requests.length;
      await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      await expect(selector).toHaveValue('');
      await expect(selector).toBeFocused();
      expect(requests).toHaveLength(beforeCancel);
      expect((await persisted(page, task.id)).project_id).toBeNull();

      await selector.selectOption(project.id);
      await confirmation.getByRole('button', { name: 'Confirmar', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      await expect(selector).toHaveValue(project.id);
      expect((await persisted(page, task.id)).project_id).toBe(project.id);
      await page.reload();
      await page.getByRole('button', { name: view, exact: true }).click();
      await expect(selector).toHaveValue(project.id);
      await selector.selectOption('');
      await expect(confirmation).toContainText('Bandeja de entrada');
      await confirmation.getByRole('button', { name: 'Confirmar', exact: true }).click();
      await expect(selector).toHaveValue('');
      expect((await persisted(page, task.id)).project_id).toBeNull();
    }

    // Desktop Kanban keeps project reassignment inside its task editor.
    await page.getByRole('button', { name: 'Kanban', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    const editor = page.getByRole('dialog');
    const draftProject = editor.getByLabel('Proyecto', { exact: true });
    await draftProject.selectOption(project.id);
    await expect(confirmation).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(draftProject).toHaveValue('');
    await expect(draftProject).toBeFocused();
    expect((await persisted(page, task.id)).project_id).toBeNull();
    await draftProject.selectOption(project.id);
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(draftProject).toHaveValue('');
    await draftProject.selectOption(project.id);
    await confirmation.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(draftProject).toHaveValue(project.id);
    // Confirmation accepts the editor draft; the server changes only on explicit save.
    expect((await persisted(page, task.id)).project_id).toBeNull();
    await editor.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await persisted(page, task.id)).project_id).toBe(project.id);
    await page.reload();
    await page.getByRole('button', { name: 'Tabla', exact: true }).click();
    await expect(selector).toHaveValue(project.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });
}


test('project confirmation is translated in English and keyboard cancellation preserves assignment', async ({ page }) => {
  await login(page);
  const suffix = randomUUID().slice(0, 8);
  const title = `English fictional assignment ${suffix}`;
  const state = await mutate(page.request, '/api/tasks', { text: title, request_id: randomUUID() });
  const task = state.tasks.find(item => item.title === title)!;
  const projects = await mutate(page.request, '/api/projects', { name: `English fictional project ${suffix}` });
  const project = projects.projects.find(item => item.name === `English fictional project ${suffix}`)!;
  await mutate(page.request, '/api/preferences', { language: 'en' }, 'PATCH');
  try {
    await page.reload();
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    const selector = page.getByLabel(`Project for ${title}`, { exact: true });
    await selector.selectOption(project.id);
    const confirmation = page.getByRole('alertdialog', { name: 'Change project', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await expect(confirmation.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await expect(confirmation).toContainText('Inbox');
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(selector).toBeFocused();
    expect((await persisted(page, task.id)).project_id).toBeNull();
  } finally {
    await mutate(page.request, '/api/preferences', { language: 'es' }, 'PATCH');
  }
});
