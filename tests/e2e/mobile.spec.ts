import { expect, test } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureStreamer, expectNoHorizontalOverflow } from './helpers';

test.describe('mobile layout and navigation', () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test('core pages fit the 320 px viewport', async ({ page }) => {
    const pages = [
      { path: '/#/', heading: 'Dashboard' },
      { path: '/#/streamers', heading: 'Streamer' },
      { path: '/#/playlists', heading: 'Playlists' },
      { path: '/#/overlays', heading: 'Overlay-Studio' },
      { path: '/#/settings', heading: 'Einstellungen' },
      { path: '/#/logs', heading: 'Logs' },
      { path: '/#/diagnostics', heading: 'Diagnose' },
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

  test('bottom navigation exposes four labelled sections', async ({ page }) => {
    await page.goto('/#/');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(4);
    for (const label of ['Live', 'Inhalte', 'Studio', 'System']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Live', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Labels stay readable on small screens instead of icons only.
    await expect(nav.getByText('Inhalte')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'bottom navigation');
  });

  test('section tabs switch pages inside a section', async ({ page }) => {
    await page.goto('/#/streamers');
    const tabs = page.getByRole('navigation', { name: 'Inhalte: Unterseiten' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('link')).toHaveCount(3);
    await expect(tabs.getByRole('link', { name: 'Streamer' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await tabs.getByRole('link', { name: 'Medien' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Medien' })).toBeVisible();
    await expect(page).toHaveURL(/#\/media$/);
    await expect(
      page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', {
        name: 'Inhalte',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');

    await page.goto('/#/settings');
    const system = page.getByRole('navigation', { name: 'System: Unterseiten' });
    await expect(system.getByRole('link')).toHaveCount(3);
    await system.getByRole('link', { name: 'Logs' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Logs' })).toBeVisible();
    await system.getByRole('link', { name: 'Diagnose' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Diagnose' })).toBeVisible();
  });

  test('bottom navigation keeps the Stream-Deck reachable from Live', async ({ page }) => {
    await page.addInitScript(`
      window.__fullscreenCalls = 0;
      Element.prototype.requestFullscreen = function () {
        window.__fullscreenCalls += 1;
        return Promise.resolve();
      };
    `);
    await page.goto('/#/');
    const deck = page.getByRole('link', { name: 'Stream-Deck' });
    await expect(deck).toBeVisible();
    await deck.click();
    await expect(page).toHaveURL(/#\/deck$/);
    await expect(page.locator('.deck-title')).toHaveText('Stream-Deck');
    // Opening the deck must not force fullscreen; the button is opt-in.
    expect(
      await page.evaluate(
        () => (window as unknown as { __fullscreenCalls: number }).__fullscreenCalls,
      ),
    ).toBe(0);
    await page.getByRole('button', { name: 'Vollbild', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __fullscreenCalls: number }).__fullscreenCalls,
        ),
      )
      .toBe(1);
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

  test('overlay studio position anchors and positioning mode work', async ({ page }) => {
    await page.goto('/#/overlays');
    await expect(page.getByRole('heading', { level: 1, name: 'Overlay-Studio' })).toBeVisible();

    const anchors = page.getByRole('group', { name: 'Overlay-Position' });
    await expect(anchors).toBeVisible();
    await anchors.getByRole('button', { name: 'Unten rechts' }).click();
    await expect(anchors.getByRole('button', { name: 'Unten rechts' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Positionieren' }).click();
    await expect(page.getByRole('button', { name: 'Fertig' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'positioning mode');
    await page.getByRole('button', { name: 'Fertig' }).click();
    await expect(page.getByRole('button', { name: 'Positionieren' })).toBeVisible();
  });

  test('overlay studio collapses the preview manually', async ({ page }) => {
    await page.goto('/#/overlays');
    const collapse = page.getByRole('button', { name: 'Vorschau einklappen' });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');

    // The panel must keep its size while scrolling over the form; only the
    // chevron changes it. A scroll-triggered collapse caused a layout jump.
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: 'Vorschau einklappen' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await collapse.click();
    await expect(page.getByRole('button', { name: 'Vorschau ausklappen' })).toBeVisible();
    await page.getByRole('button', { name: 'Vorschau ausklappen' }).click();
    await expect(page.getByRole('button', { name: 'Vorschau einklappen' })).toBeVisible();
  });

  test('settings and overlay studio stay usable', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByLabel('Haupttext').first()).toBeVisible();

    await page.goto('/#/overlays');
    await expect(page.getByRole('heading', { level: 1, name: 'Overlay-Studio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live-Vorschau' })).toBeVisible();
    await clickStudioTab(page, 'Einnahmen');
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
    await clickStudioTab(page, 'Einnahmen');
    await expect(page.getByLabel('Template')).toHaveValue(templateValue);

    await clickStudioTab(page, 'Video');
    const videoToggle = page.getByRole('switch', { name: /Video-Layout/ });
    await videoToggle.check();
    const scale = page.locator('#studio-video-scale');
    const posX = page.locator('#studio-video-position-x');
    const posY = page.locator('#studio-video-position-y');
    // Pick targets that differ from the persisted state so the test stays repeatable.
    const scaleTarget = (await scale.inputValue()) === '160' ? '150' : '160';
    const xTarget = (await posX.inputValue()) === '25' ? '30' : '25';
    const yTarget = (await posY.inputValue()) === '75' ? '70' : '75';
    await scale.fill(scaleTarget);
    await posX.fill(xTarget);
    await posY.fill(yTarget);
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      page.getByText('Globale Overlay- und Video-Einstellungen gespeichert.').first(),
    ).toBeVisible();
    await page.reload();
    await clickStudioTab(page, 'Video');
    await expect(page.locator('#studio-video-scale')).toHaveValue(scaleTarget);
    await expect(page.locator('#studio-video-position-x')).toHaveValue(xTarget);
    await expect(page.locator('#studio-video-position-y')).toHaveValue(yTarget);

    await page.getByRole('switch', { name: /Video-Layout/ }).uncheck();
    const resetScale = (await page.locator('#studio-video-scale').inputValue()) === '100' ? '90' : '100';
    await page.locator('#studio-video-scale').fill(resetScale);
    await page.locator('#studio-video-position-x').fill('50');
    await page.locator('#studio-video-position-y').fill('50');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      page.getByText('Globale Overlay- und Video-Einstellungen gespeichert.').first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, '/#/overlays');
  });
});

test.describe('tablet overlay studio', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: false, hasTouch: true });

  test('uses the compact editor without horizontal overflow', async ({ page }) => {
    await page.goto('/#/overlays');
    await expect(page.getByRole('heading', { level: 1, name: 'Overlay-Studio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Live-Vorschau' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Positionieren' })).toBeVisible();
    const preview = await page.locator('.overlay-preview-card').boundingBox();
    const settings = await page.locator('.overlay-settings-card').boundingBox();
    expect(preview?.width ?? 0).toBeGreaterThan(280);
    // Tablet uses a two-column editor: preview left, settings right.
    expect((preview?.x ?? 0) + (preview?.width ?? 0)).toBeLessThan(settings?.x ?? 0);
    await expectNoHorizontalOverflow(page, 'tablet overlay studio');
  });
});

/** Studio tabs live in a scrollable strip below the sticky preview. */
async function clickStudioTab(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await tab.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center' }));
  await tab.click();
}
