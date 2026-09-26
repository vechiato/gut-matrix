// Main user path through the real UI: create → add/score → save → reload →
// export/import CSV → recent lists → delete. The list is deleted at the end,
// so runs don't leave data behind.

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('create, score, save, reload, export/import and delete a list', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text());
  });
  page.on('dialog', dialog => dialog.accept()); // delete confirmation, unsaved-changes prompt

  const title = `Smoke test ${Date.now()}`;
  const label = 'Reduce checkout latency';

  // Create
  await page.goto('/');
  await page.fill('#title', title);
  await page.click('#createForm button[type="submit"]');
  await page.waitForURL(/\/matrix(\.html)?\?k=/);
  await expect(page.locator('#listTitle')).toHaveText(title);

  // Add an item, name it and score it with the chips
  await page.click('#addItemBtn');
  const row = page.locator('#itemsBody tr').first();
  await row.locator('.input-label').fill(label);
  for (const [field, value] of [['g', 5], ['u', 4], ['t', 3]] as const) {
    await row.locator(`.chip[data-field="${field}"][data-value="${value}"]`).click();
  }
  await expect(row.locator('.score-display')).toHaveText('60');

  // Save
  const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/api/list/'));
  await page.click('#saveBtn');
  expect((await saved).status()).toBe(200);
  await expect(page.locator('#status')).toContainText('Saved');

  // Reload: the server kept the label and my score
  await page.reload();
  const reloaded = page.locator('#itemsBody tr').first();
  await expect(reloaded.locator('.input-label')).toHaveValue(label);
  await expect(reloaded.locator('.score-display')).toHaveText('60');

  // Export CSV
  const download = page.waitForEvent('download');
  await page.click('#exportCsvBtn');
  const csv = await readFile((await (await download).path())!, 'utf8');
  expect(csv).toContain(`${label},5,4,3,60`);

  // Import CSV adds a scored item
  await page.setInputFiles('#importFileInput', {
    name: 'import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Item,Your G,Your U,Your T,Your Score\nImported item,2,2,2,8\n'),
  });
  await expect(page.locator('#itemsBody tr')).toHaveCount(2);
  await expect(page.locator('#itemsBody tr').nth(1).locator('.score-display')).toHaveText('8');

  // Recent lists on the home page link back to the list
  await page.goto('/');
  const recent = page.locator('#recentList .recent-item', { hasText: title });
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(page.locator('#listTitle')).toHaveText(title);

  // Delete with the owner token saved at creation
  const deleted = page.waitForResponse(r => r.request().method() === 'DELETE');
  await page.click('#deleteBtn');
  expect((await deleted).status()).toBe(204);
  await page.waitForURL(url => new URL(url).pathname === '/');
  await expect(page.locator('#recentList')).not.toContainText(title);

  expect(errors).toEqual([]);
});
