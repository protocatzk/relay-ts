import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

/**
 * Discovery panel in the cockpit (#92). Provider calls are stubbed so the test
 * never touches TikTok.
 */

const HITS = [
  { handle: 'live_gamer', display_name: 'Live Gamer', viewers: 1240 },
  { handle: 'dj_mia', display_name: 'DJ Mia', viewers: 812 },
  { handle: 'talk_klaus', display_name: 'Talk Klaus', viewers: 44 },
].map((entry) => ({
  ...entry,
  avatar_url: null,
  bio: null,
  title: 'Teststream',
  live: true,
  source: 'live_page',
  fetched_at: new Date().toISOString(),
}));

const PROVIDERS = [
  { name: 'live_page', status: 'online', last_error: null, last_ok_at: null },
  { name: 'room_info', status: 'online', last_error: null, last_ok_at: null },
  { name: 'search_api', status: 'online', last_error: null, last_ok_at: null },
];

async function stubDiscovery(page: Page): Promise<void> {
  await page.route('**/api/discovery/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/preview/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (url.includes('/suggest')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suggestions: [
            { handle: 'live_gamer', display_name: 'Live Gamer', avatar_url: null },
          ],
          providers: PROVIDERS,
        }),
      });
      return;
    }
    if (url.includes('/status')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ statuses: { live_gamer: 'live' }, checked_at: new Date().toISOString() }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hits: HITS,
        providers: PROVIDERS,
        fetched_at: new Date().toISOString(),
      }),
    });
  });
}

test.describe('discovery panel', () => {
  test('opens with D, lists hits and closes with Escape', async ({ page }) => {
    await stubDiscovery(page);
    await page.goto('/#/', { waitUntil: 'networkidle' });

    await page.keyboard.press('d');
    const panel = page.locator('.discovery-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('.hit-row')).toHaveCount(3);
    await expect(panel.getByText('Live Gamer')).toBeVisible();
    await expect(page.locator('#discovery-panel-search')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('.discovery-panel')).toHaveCount(0);
  });

  test('pushes the cockpit grid on desktop', async ({ page }) => {
    await stubDiscovery(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/', { waitUntil: 'networkidle' });

    const closed = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector('.cockpit-grid')!).gridTemplateColumns.split(' ').length,
      gridWidth: document.querySelector('.cockpit-grid')!.getBoundingClientRect().width,
    }));
    await page.keyboard.press('d');
    await expect(page.locator('.discovery-panel')).toBeVisible();

    // The padding is animated (180 ms); wait for it to settle before measuring.
    await page.waitForFunction(
      () =>
        parseFloat(
          getComputedStyle(document.querySelector('.page-dashboard') as HTMLElement).paddingRight,
        ) > 300,
    );
    const open = await page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector('.cockpit-grid')!).gridTemplateColumns.split(' ').length,
      padding: parseFloat(getComputedStyle(document.querySelector('.page-dashboard')!).paddingRight),
      gridWidth: document.querySelector('.cockpit-grid')!.getBoundingClientRect().width,
    }));
    // The cockpit keeps its 3-column desktop grid; the panel reserves space
    // and the cockpit grid shrinks with it (#94).
    expect(closed.columns).toBe(3);
    expect(open.columns).toBeGreaterThanOrEqual(2);
    expect(open.padding).toBeGreaterThan(300);
    expect(open.gridWidth).toBeLessThan(closed.gridWidth);
    await expectNoHorizontalOverflow(page, 'cockpit with discovery panel');
  });

  test('header search opens the panel with the typed query', async ({ page }) => {
    await stubDiscovery(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/', { waitUntil: 'networkidle' });

    await page.getByLabel('Discovery-Suche').fill('gaming');
    await page.getByLabel('Discovery-Suche').press('Enter');

    await expect(page.locator('.discovery-panel')).toBeVisible();
    await expect(page.locator('#discovery-panel-search')).toHaveValue('gaming');
  });

  test('queue action reaches the queue API', async ({ page }) => {
    await stubDiscovery(page);
    const queueRequests: string[] = [];
    await page.route('**/api/discovery/queue', async (route) => {
      queueRequests.push(route.request().postData() ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          streamer: { id: 'live_gamer', name: 'Live Gamer', tiktok: 'live_gamer', enabled: true },
          created: true,
          queue: { entries: [], playing: false, index: null, loop: false },
          status: { state: 'idle' },
        }),
      });
    });

    await page.goto('/#/', { waitUntil: 'networkidle' });
    await page.keyboard.press('d');
    await page.locator('.hit-row').first().getByRole('button', { name: 'In die Queue' }).click();

    await expect.poll(() => queueRequests.length).toBeGreaterThan(0);
    expect(queueRequests[0]).toContain('live_gamer');
  });

  test('mobile shows a bottom sheet without horizontal overflow', async ({ page }) => {
    await stubDiscovery(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/', { waitUntil: 'networkidle' });

    await page.keyboard.press('d');
    const panel = page.locator('.discovery-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-sheet/);

    const box = await panel.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
    expect(box?.x ?? 1).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page, 'discovery sheet');
  });
});
