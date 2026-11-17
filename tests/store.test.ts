import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';

const logger = pino({ level: 'silent' });

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-store-'));
  return new StreamerStore(join(dir, 'streamers.yml'), { streamers: [], playlists: [] }, logger);
}

describe('StreamerStore', () => {
  it('creates, updates and removes streamers while persisting YAML', () => {
    const store = makeStore();
    const created = store.create({
      id: 'alpha',
      name: 'Alpha',
      tiktok: '@alpha',
      youtube_key: 'secret-key',
      quality: '720p',
    });
    expect(created.id).toBe('alpha');
    expect(store.get('alpha')?.quality).toBe('720p');

    const updated = store.update('alpha', { name: 'Alpha 2', overlays: { chat: { enabled: true } } });
    expect(updated.name).toBe('Alpha 2');
    expect(updated.quality).toBe('720p');
    expect(updated.overlays.chat.enabled).toBe(true);
    expect(updated.overlays.clock.enabled).toBe(false);

    const view = store.view(updated, 'alpha', true);
    expect(view.youtube_key_set).toBe(true);
    expect(view.overlays.chat.api_key_set).toBe(false);
    expect((view as unknown as { youtube_key?: string }).youtube_key).toBeUndefined();
    expect(view.status.active).toBe(true);

    store.remove('alpha');
    expect(store.get('alpha')).toBeUndefined();
  });

  it('rejects duplicate ids and id changes', () => {
    const store = makeStore();
    store.create({ id: 'alpha', name: 'Alpha', tiktok: 'alpha' });
    expect(() => store.create({ id: 'alpha', name: 'Alpha 2', tiktok: 'alpha2' })).toThrow(
      /bereits vergeben/,
    );
    expect(() => store.update('alpha', { id: 'beta' })).toThrow(/nicht geändert/);
  });

  it('resolves playlist channels by id, handle or name', () => {
    const store = makeStore();
    store.create({ id: 'alpha', name: 'Alpha', tiktok: 'alpha_live' });
    expect(store.findForChannel('alpha')?.id).toBe('alpha');
    expect(store.findForChannel('@alpha_live')?.id).toBe('alpha');
  });

  it('creates, updates and removes playlists', () => {
    const store = makeStore();
    const created = store.createPlaylist({
      id: 'abend',
      name: 'Abend',
      channels: ['alpha', 'beta'],
      auto_advance: true,
      end_time: '23:00',
    });
    expect(created.channels).toEqual(['alpha', 'beta']);
    expect(store.playlist('abend')?.name).toBe('Abend');
    expect(store.playlist('abend')?.end_time).toBe('23:00');

    const updated = store.updatePlaylist('abend', {
      name: 'Abend 2',
      channels: ['alpha'],
      wrap: true,
      end_time: null,
      end_after_minutes: 120,
    });
    expect(updated.name).toBe('Abend 2');
    expect(updated.channels).toEqual(['alpha']);
    expect(updated.wrap).toBe(true);
    expect(updated.end_time).toBeNull();
    expect(updated.end_after_minutes).toBe(120);

    store.removePlaylist('abend');
    expect(store.playlist('abend')).toBeUndefined();
    expect(() => store.removePlaylist('abend')).toThrow(/nicht gefunden/);
  });
});

describe('SettingsService', () => {
  it('sanitizes secrets and keeps them on partial updates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-settings-'));
    const service = new SettingsService(join(dir, 'settings.yml'), DEFAULT_SETTINGS, logger);
    service.update({ online: { api_key: 'top-secret' } });
    const sanitized = service.sanitized();
    expect(sanitized.online.api_key_set).toBe(true);
    expect((sanitized.online as unknown as { api_key?: string }).api_key).toBeUndefined();

    const { next } = service.update({ video: { fps: 30 } });
    expect(next.video.fps).toBe(30);
    expect(next.online.api_key).toBe('top-secret');
  });

  it('rejects invalid values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-settings-'));
    const service = new SettingsService(join(dir, 'settings.yml'), DEFAULT_SETTINGS, logger);
    expect(() => service.update({ video: { fps: 999 } })).toThrow(/Ungültige Einstellungen/);
  });
});
