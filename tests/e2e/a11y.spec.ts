import { expect, test } from '@playwright/test';
import { ensureStreamer } from './helpers';

test.describe('accessibility smoke checks', () => {
  test('skip link, landmarks and headings are present', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('streamer table exposes a caption and column headers', async ({ page, request }) => {
    await ensureStreamer(request);
    await page.goto('/#/streamers');
    const table = page.getByRole('table', { name: /Streamer-Liste/ });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Streamer' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Aktionen' })).toBeVisible();
  });

  test('settings inputs have accessible names', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
    const unlabeled = await page
      .locator('input:not([type="hidden"]), select, textarea')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .filter((node) => {
            const element = node as HTMLInputElement;
            return (
              element.labels?.length === 0 &&
              !element.getAttribute('aria-label') &&
              !element.getAttribute('aria-labelledby') &&
              !element.getAttribute('title')
            );
          })
          .map((node) => (node as HTMLElement).outerHTML.slice(0, 160)),
      );
    expect(unlabeled).toEqual([]);
  });

  test('live menu shows stream control and closes with Escape', async ({ page, request }) => {
    await ensureStreamer(request);
    await page.goto('/#/');
    const trigger = page.getByRole('button', { name: /Live-Steuerung öffnen/ });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const dialog = page.getByRole('dialog', { name: 'Live-Steuerung' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Aktiver Stream' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Live-Streamer' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Streamer verwalten' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('theme toggle switches between dark and light', async ({ page }) => {
    await page.goto('/#/');
    const toggle = page.getByRole('button', { name: /Theme:/ });
    const initial = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
    await toggle.click();
    const next = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
    expect(next).not.toBe(initial);
    await expectNoOverflow(page);
  });
});

async function expectNoOverflow(page: import('@playwright/test').Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}
