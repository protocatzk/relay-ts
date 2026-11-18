import { expect, test } from '@playwright/test';
import { ensureStreamer, expectNoHorizontalOverflow } from './helpers';

test.describe('mobile layout and drawer', () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test('core pages fit the 320 px viewport', async ({ page }) => {
    const pages = [
      { path: '/#/', heading: 'Dashboard' },
      { path: '/#/streamers', heading: 'Streamer' },
      { path: '/#/playlists', heading: 'Playlists' },
      { path: '/#/overlays', heading: 'Overlay-Studio' },
      { path: '/#/settings', heading: 'Einstellungen' },
      { path: '/#/logs', heading: 'Logs' },
    ];
    for (const item of pages) {
      await page.goto(item.path);
      await expect(page.getByRole('heading', { level: 1, name: item.heading })).toBeVisible();
      await page.waitForTimeout(250);
      await expectNoHorizontalOverflow(page, item.path);
    }
  });

  test('drawer traps focus, closes with Escape and restores focus', async ({ page }) => {
    await page.goto('/#/');
    const toggle = page.getByRole('button', { name: 'Navigation öffnen' });
    await toggle.click();

    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(page.getByRole('button', { name: 'Menü schließen' })).toBeFocused();

    const focusables = sidebar.locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    const count = await focusables.count();
    for (let index = 0; index < count + 2; index += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('#sidebar')),
      );
      expect(inside, `focus left the drawer after ${index + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/is-open/);
    await expect(toggle).toBeFocused();
  });

  test('streamer table becomes labelled cards', async ({ page, request }) => {
    await ensureStreamer(request);
    await page.goto('/#/streamers');
    await expect(page.getByRole('heading', { level: 1, name: 'Streamer' })).toBeVisible();
    await expect(page.getByText('E2E Streamer').first()).toBeVisible();
    const card = page.locator('tbody tr').filter({ hasText: 'E2E Streamer' }).first();
    await expect(card.locator('td[data-label="Status"]')).toBeVisible();
    await expect(card.locator('td[data-label="Aktionen"]')).toBeVisible();
  });

  test('settings and overlay studio stay usable', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByLabel('Haupttext').first()).toBeVisible();

    await page.goto('/#/overlays');
    await expect(page.getByRole('heading', { level: 1, name: 'Overlay-Studio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live-Vorschau' })).toBeVisible();
    await expectNoHorizontalOverflow(page, '/#/overlays');
  });
});
