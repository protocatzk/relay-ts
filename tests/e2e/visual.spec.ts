import { expect, test } from '@playwright/test';

const CORE_ROUTES = ['/#/', '/#/overlays', '/#/settings', '/#/youtube', '/#/output'];

test.describe('Visual & theme regression checks (#43, #27)', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`renders core routes without horizontal overflow in ${theme} mode`, async ({ page }) => {
      await page.addInitScript((mode) => {
        window.localStorage.setItem('relay-theme', mode);
      }, theme);

      for (const route of CORE_ROUTES) {
        await page.goto(route, { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `Overflow on ${route} (${theme})`).toBeLessThanOrEqual(2);
      }
    });
  }

  test('follows prefers-color-scheme when theme preference is auto', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      window.localStorage.setItem('relay-theme', 'auto');
    });
    await page.goto('/#/', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
