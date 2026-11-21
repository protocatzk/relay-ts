import { describe, expect, it } from 'vitest';
import { PlaylistSchema, StreamerSchema } from '../src/core/config/schema.js';
import { formatStreamTitle, buildPlaylistsView } from '../src/core/supervisor/supervisor-views.js';

describe('supervisor-views', () => {
  it('formats stream title with template variables', () => {
    const streamer = StreamerSchema.parse({
      id: 'streamer-1',
      name: 'Max Mustermann',
      tiktok: '@maxlive',
    });
    const template = 'LIVE: {name} ({tiktok}) - {title}';
    const result = formatStreamTitle(template, streamer, 'Spezial-Stream');

    expect(result).toBe('LIVE: Max Mustermann (maxlive) - Spezial-Stream');
  });

  it('builds playlists view reflecting active index and channel key status', () => {
    const pl1 = PlaylistSchema.parse({
      id: 'pl-1',
      name: 'Main Playlist',
      channels: ['ch-1'],
    });
    const streamer = StreamerSchema.parse({
      id: 'ch-1',
      name: 'Channel 1',
      tiktok: 'ch1',
      youtube_key: 'key-123',
    });

    const views = buildPlaylistsView([pl1], { playlist: pl1, index: 0 }, (id) =>
      id === 'ch-1' ? streamer : null,
    );

    expect(views).toHaveLength(1);
    expect(views[0]?.id).toBe('pl-1');
    expect(views[0]?.active).toBe(true);
    expect(views[0]?.index).toBe(0);
    expect(views[0]?.youtube_key_set).toBe(true);
  });
});
