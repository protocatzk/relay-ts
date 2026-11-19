import { expect, test } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

  test('live menu fits the viewport and closes with Escape', async ({ page }) => {
    await page.goto('/#/');
    const trigger = page.getByRole('button', { name: /Live-Steuerung öffnen/ });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Live-Steuerung' });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalOverflow(page, 'live menu');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
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

  test('detects videos added to data/media while the editor is open', async ({ page }) => {
    const mediaDir = join(process.cwd(), '.playwright', 'data', 'media');
    mkdirSync(mediaDir, { recursive: true });
    const filename = `e2e-${Date.now()}.mp4`;
    const path = join(mediaDir, filename);
    writeFileSync(path, Buffer.from([0, 0, 0, 0]));
    try {
      await page.goto('/#/playlists');
      await page.getByRole('button', { name: 'Neue Playlist' }).click();
      await expect(page.locator('#playlist-media option', { hasText: filename })).toHaveCount(1, {
        timeout: 8_000,
      });
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('settings and overlay studio stay usable', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByLabel('Haupttext').first()).toBeVisible();

    await page.goto('/#/overlays');
    await expect(page.getByRole('heading', { level: 1, name: 'Overlay-Studio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live-Vorschau' })).toBeVisible();
    await page.getByRole('tab', { name: 'Einnahmen' }).click();
    await expect(page.getByLabel('Template')).toBeVisible();
    await expect(page.getByLabel('Offset X (px)')).toBeVisible();
    await expect(page.locator('#studio-earnings-font-color')).toBeVisible();
    const templateValue = `{net} € · Studio-${Date.now()}`;
    await page.getByLabel('Template').fill(templateValue);
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      page.getByText('Globale Overlay- und Video-Einstellungen gespeichert.').first(),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Einnahmen' }).click();
    await expect(page.getByLabel('Template')).toHaveValue(templateValue);

    await page.getByRole('tab', { name: 'Video' }).click();
    const videoToggle = page.getByRole('switch', { name: /Video-Layout/ });
    await videoToggle.check();
    await page.locator('#studio-video-scale').fill('160');
    await page.locator('#studio-video-position-x').fill('25');
    await page.locator('#studio-video-position-y').fill('75');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      page.getByText('Globale Overlay- und Video-Einstellungen gespeichert.').first(),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Video' }).click();
    await expect(page.locator('#studio-video-scale')).toHaveValue('160');
    await expect(page.locator('#studio-video-position-x')).toHaveValue('25');
    await expect(page.locator('#studio-video-position-y')).toHaveValue('75');

    await page.getByRole('switch', { name: /Video-Layout/ }).uncheck();
    await page.locator('#studio-video-scale').fill('100');
    await page.locator('#studio-video-position-x').fill('50');
    await page.locator('#studio-video-position-y').fill('50');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      page.getByText('Globale Overlay- und Video-Einstellungen gespeichert.').first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, '/#/overlays');
  });
});
