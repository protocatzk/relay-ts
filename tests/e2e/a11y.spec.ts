import { expect, test } from '@playwright/test';
import { ensureStreamer, toggleTheme } from './helpers';

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
    const initial = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
    await toggleTheme(page);
    const next = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
    expect(next).not.toBe(initial);
    await expectNoOverflow(page);
  });

  test('overlay studio tabs support keyboard navigation and aria linkage', async ({ page }) => {
    await page.goto('/#/overlays');
    const tablist = page.getByRole('tablist', { name: 'Overlay-Bereich' });
    await expect(tablist).toBeVisible();

    const chatTab = tablist.getByRole('tab', { name: 'Chat' });
    const clockTab = tablist.getByRole('tab', { name: 'Uhrzeit' });
    const videoTab = tablist.getByRole('tab', { name: 'Video' });
    const earningsTab = tablist.getByRole('tab', { name: 'Einnahmen' });
    const versionTab = tablist.getByRole('tab', { name: 'Version' });

    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(chatTab).toHaveAttribute('tabindex', '0');
    await expect(chatTab).toHaveAttribute('aria-controls', 'studio-panel-chat');
    await expect(clockTab).toHaveAttribute('aria-selected', 'false');
    await expect(clockTab).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'studio-panel-chat');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'studio-tab-chat');

    await chatTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(clockTab).toBeFocused();
    await expect(clockTab).toHaveAttribute('aria-selected', 'true');
    await expect(clockTab).toHaveAttribute('tabindex', '0');
    await expect(chatTab).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'studio-panel-clock');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'studio-tab-clock');

    await page.keyboard.press('End');
    await expect(versionTab).toBeFocused();
    await expect(versionTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'studio-panel-version');

    await page.keyboard.press('Home');
    await expect(videoTab).toBeFocused();
    await expect(videoTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'studio-panel-video');

    // ArrowLeft from the first tab wraps to the last one (Version).
    await page.keyboard.press('ArrowLeft');
    await expect(versionTab).toBeFocused();
    await expect(versionTab).toHaveAttribute('aria-selected', 'true');

    // ArrowLeft again moves one tab back to Einnahmen.
    await page.keyboard.press('ArrowLeft');
    await expect(earningsTab).toBeFocused();
    await expect(earningsTab).toHaveAttribute('aria-selected', 'true');
  });

  test('unsaved changes guard prompts only when dirty on route leave and modal close', async ({
    page,
  }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();

    // Clean state: beforeunload is not prevented and navigation does not prompt.
    const cleanPrevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(cleanPrevented).toBe(false);

    await page.getByRole('navigation', { name: 'System: Unterseiten' }).getByRole('link', { name: 'Logs' }).click();
    await expect(page).toHaveURL(/#\/logs$/);
    await expect(page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })).toHaveCount(0);

    // Dirty state on /settings: beforeunload is prevented and route change opens dialog.
    const settingsLoaded = page.waitForResponse(
      (response) => response.url().endsWith('/api/settings') && response.request().method() === 'GET',
    );
    await page.goto('/#/settings');
    await settingsLoaded;
    const titleInput = page.locator('#title-template');
    await expect(titleInput).toBeVisible();
    const originalTitle = await titleInput.inputValue();
    await titleInput.fill(`${originalTitle} (entwurf)`);
    // Wait for the dirty watcher to register the beforeunload guard.
    await expect(page.getByText('Ungespeicherte Änderungen').first()).toBeVisible();

    const dirtyPrevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(dirtyPrevented).toBe(true);

    await page.getByRole('navigation', { name: 'System: Unterseiten' }).getByRole('link', { name: 'Logs' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Bleiben' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(titleInput).toHaveValue(`${originalTitle} (entwurf)`);

    await page.getByRole('navigation', { name: 'System: Unterseiten' }).getByRole('link', { name: 'Logs' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page).toHaveURL(/#\/logs$/);

    // Dirty state on /overlays also guards route navigation.
    await page.goto('/#/overlays');
    await expect(page.getByRole('heading', { level: 1, name: 'Overlay-Studio' })).toBeVisible();
    // On phones the studio sections are accordions; open the chat tab and its
    // "Layout & Begrenzungen" group before editing.
    await page.getByRole('tab', { name: 'Chat' }).click();
    const layoutGroup = page.locator('.studio-group', { hasText: 'Layout & Begrenzungen' }).first();
    if (!(await layoutGroup.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await layoutGroup.locator('summary').click();
    }
    const chatFont = page.locator('#studio-chat-font-size');
    await expect(chatFont).toBeVisible();
    const currentFont = await chatFont.inputValue();
    await chatFont.fill(currentFont === '24' ? '26' : '24');
    await page
      .getByRole('navigation', { name: 'Studio: Unterseiten' })
      .getByRole('link', { name: 'YouTube' })
      .click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page).toHaveURL(/#\/youtube$/);

    // Dirty playlist editor modal prompts on close.
    await page.goto('/#/playlists');
    await page.getByRole('button', { name: 'Neue Playlist' }).click();
    const playlistModal = page.getByRole('dialog', { name: 'Neue Playlist' });
    await expect(playlistModal).toBeVisible();
    await playlistModal.locator('#playlist-name').fill('Entwurf-Playlist');
    await playlistModal.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Bleiben' }).click();
    await expect(playlistModal).toBeVisible();
    await playlistModal.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(playlistModal).toHaveCount(0);
  });

  test('settings sections can be saved independently without overwriting other cards', async ({
    page,
  }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();

    const stallInput = page.locator('#watchdog-stall');
    const titleInput = page.locator('#title-template');
    const originalStall = await stallInput.inputValue();
    const nextStall = originalStall === '35' ? '40' : '35';
    const originalTitle = await titleInput.inputValue();
    const unsavedTitle = `Unsaved-${Date.now()}`;

    await stallInput.fill(nextStall);
    await titleInput.fill(unsavedTitle);

    const watchdogCard = page.locator('#settings-watchdog');
    const titleCard = page.locator('#settings-title');
    await expect(watchdogCard.getByText('Ungespeichert')).toBeVisible();
    await expect(titleCard.getByText('Ungespeichert')).toBeVisible();

    const putRequestPromise = page.waitForRequest(
      (req) => req.url().endsWith('/api/settings') && req.method() === 'PUT',
    );
    await watchdogCard.getByRole('button', { name: 'Watchdog speichern' }).click();
    const putRequest = await putRequestPromise;
    // The watchdog card also owns the sink read/write timeout, so both
    // sections travel in one request.
    expect(Object.keys(putRequest.postDataJSON() as Record<string, unknown>).sort()).toEqual([
      'sink',
      'watchdog',
    ]);
    await expect(page.getByText('Bereich „Watchdog“ gespeichert.').first()).toBeVisible();

    // Watchdog is clean again; YouTube-Titel still keeps its unsaved edit.
    await expect(watchdogCard.getByText('Ungespeichert')).toHaveCount(0);
    await expect(titleCard.getByText('Ungespeichert')).toBeVisible();
    await expect(titleInput).toHaveValue(unsavedTitle);

    // Discard the unsaved title edit and verify persisted state from server.
    await page.getByRole('button', { name: 'Zurücksetzen' }).click();
    await expect(stallInput).toHaveValue(nextStall);
    await expect(titleInput).toHaveValue(originalTitle);
    await expectNoOverflow(page);
  });

  test('diagnostics page renders versions, ports, storage and confirmed actions', async ({
    page,
  }) => {
    await page.goto('/#/diagnostics');
    await expect(page.getByRole('heading', { level: 1, name: 'Diagnose' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Laufzeit & Versionen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ports & Stream-Status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Speicherbelegung' })).toBeVisible();

    await page.getByRole('button', { name: 'Sink neu starten' }).click();
    const confirm = page.getByRole('dialog', { name: 'Sink neu starten' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(confirm).toHaveCount(0);
    await expectNoOverflow(page);
  });

  test('logs view switches between server, streamer and audit views and supports export', async ({
    page,
  }) => {
    await page.goto('/#/logs');
    await expect(page.getByRole('heading', { level: 1, name: 'Logs' })).toBeVisible();
    const modeTabs = page.getByRole('tablist', { name: 'Log-Ansicht' });
    await expect(modeTabs.getByRole('tab', { name: 'Server-Logs' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('button', { name: '.log' })).toBeVisible();
    await expect(page.getByRole('button', { name: '.json' })).toBeVisible();

    await modeTabs.getByRole('tab', { name: 'Streamer-Logs' }).click();
    await expect(page.locator('#log-streamer')).toBeVisible();

    await modeTabs.getByRole('tab', { name: 'Audit-Log' }).click();
    await expect(page.locator('#audit-actor')).toBeVisible();
    await expect(page.locator('#audit-action')).toBeVisible();
    await expectNoOverflow(page);
  });

  test('playlist editor manages channels as a keyboard-reorderable list with duplicate badges', async ({
    page,
  }) => {
    await page.goto('/#/playlists');
    await page.getByRole('button', { name: 'Neue Playlist' }).click();
    const modal = page.getByRole('dialog', { name: 'Neue Playlist' });
    await expect(modal).toBeVisible();

    const input = modal.locator('#playlist-channel-input');
    await input.fill('first_handle');
    await modal.getByRole('button', { name: 'Hinzufügen' }).click();
    await input.fill('second_handle');
    await modal.getByRole('button', { name: 'Hinzufügen' }).click();
    await input.fill('first_handle');
    await modal.getByRole('button', { name: 'Hinzufügen' }).click();

    const list = modal.getByRole('list', { name: 'Playlist-Reihenfolge' });
    await expect(list.locator('li')).toHaveCount(3);
    await expect(list.getByText('Duplikat')).toHaveCount(1);

    await list.getByRole('button', { name: 'second_handle nach oben' }).click();
    await expect(list.locator('li').first()).toContainText('second_handle');
  });

  test('stream deck customizes action order and persists per device', async ({ page }) => {
    await page.goto('/#/deck');
    await page.getByRole('button', { name: 'Anpassen' }).click();
    await expect(page.getByRole('region', { name: 'Aktionen anpassen' })).toBeVisible();

    await page.getByRole('button', { name: 'Stop nach oben' }).click();
    await page.reload();
    const firstAction = page.locator('.deck-actions .deck-btn').first();
    await expect(firstAction).toContainText('Stop');
  });
});

async function expectNoOverflow(page: import('@playwright/test').Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}
