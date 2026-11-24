import { expect, type APIRequestContext, type Page } from '@playwright/test';

export async function ensureStreamer(request: APIRequestContext): Promise<void> {
  const list = await request.get('/api/streamers');
  if (!list.ok()) return;
  const data = (await list.json()) as { streamers?: Array<{ id: string }> } | Array<{ id: string }>;
  const items = Array.isArray(data) ? data : (data.streamers ?? []);
  if (items.some((item) => item.id === 'e2e')) return;
  await request.post('/api/streamers', {
    data: {
      id: 'e2e',
      name: 'E2E Streamer',
      tiktok: 'e2e_streamer',
      youtube_key: 'test-key',
    },
  });
}

export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${label}: scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

/**
 * Flips the theme on any viewport. Below 520 px the control lives in the
 * "Weitere Optionen" header menu instead of the toolbar (#88).
 */
export async function toggleTheme(page: Page): Promise<void> {
  const direct = page.getByRole('button', { name: /Theme:/ });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  const more = page.getByRole('button', { name: 'Weitere Optionen & Konto' });
  await more.click();
  await page.getByRole('menuitem', { name: /Erscheinungsbild/ }).click();
}
