import type { Logger } from 'pino';
import type { LoadedConfig } from '../config/loader.js';
import {
  resolveStreamKey,
  setGlobalStreamKeyOverride,
  type Settings,
  type StreamerConfig,
} from '../config/schema.js';
import type { StatusSnapshot, StreamState } from '../events.js';
import {
  configureVideoEncoder,
  probeVideoEncoders,
  setAvailableVideoEncoders,
} from '../media/encoders.js';
import type { DelayBuffer } from '../relay/delay-buffer.js';
import type { SourceSession } from './source-session.js';
import type { SinkController } from './sink-controller.js';
import type { OutputFanout } from './output-fanout.js';
import type { OverlayManager } from '../overlays/overlay-manager.js';
import { isBroadcastCanvasMode } from '../overlays/canvas-utils.js';
import type { OverlayRuntime } from './overlay-runtime.js';
import type { PauseController } from './pause-controller.js';
import type { Watchdog } from './watchdog.js';
import type { AutoRefresh } from './auto-refresh.js';
import type { OnlineMonitor } from '../online/monitor.js';
import type { EarningsMonitor } from '../earnings/monitor.js';
import type { SceneStore } from '../overlays/scene-store.js';
import type { MediaPlaybackController } from './media-playback-controller.js';
import type { RtmpIngestServer } from '../ingest/rtmp-server.js';
import type { SoundboardEngine } from '../soundboard/engine.js';

export interface SettingsDiff {
  videoEncoderChanged: boolean;
  videoEncodeChanged: boolean;
  overlaysChanged: boolean;
  earningsOverlayChanged: boolean;
  videoLayoutChanged: boolean;
  audioChanged: boolean;
  soundboardPipeChanged: boolean;
  chatChanged: boolean;
  sinkTimeoutChanged: boolean;
  youtubeRtmpChanged: boolean;
}

export function diffSettings(previous: Settings, next: Settings): SettingsDiff {
  const videoEncoderChanged = previous.video.encoder !== next.video.encoder;
  const videoEncodeChanged =
    previous.video.resolution !== next.video.resolution ||
    previous.video.fps !== next.video.fps ||
    previous.video.video_bitrate !== next.video.video_bitrate ||
    previous.video.audio_bitrate !== next.video.audio_bitrate ||
    previous.video.preset !== next.video.preset ||
    videoEncoderChanged;

  const overlaysChanged = JSON.stringify(previous.overlays) !== JSON.stringify(next.overlays);
  const earningsOverlayChanged =
    previous.earnings.overlay_enabled !== next.earnings.overlay_enabled ||
    previous.earnings.overlay_position !== next.earnings.overlay_position ||
    previous.earnings.overlay_template !== next.earnings.overlay_template ||
    previous.earnings.overlay_font_size !== next.earnings.overlay_font_size ||
    previous.earnings.overlay_margin !== next.earnings.overlay_margin ||
    previous.earnings.overlay_offset_x !== next.earnings.overlay_offset_x ||
    previous.earnings.overlay_offset_y !== next.earnings.overlay_offset_y ||
    previous.earnings.overlay_font_color !== next.earnings.overlay_font_color ||
    previous.earnings.overlay_box_color !== next.earnings.overlay_box_color ||
    previous.earnings.overlay_show_box !== next.earnings.overlay_show_box;

  const videoLayoutChanged =
    JSON.stringify(previous.video.layout) !== JSON.stringify(next.video.layout);
  const audioChanged = JSON.stringify(previous.audio) !== JSON.stringify(next.audio);
  const soundboardPipeChanged =
    previous.soundboard.enabled !== next.soundboard.enabled ||
    (next.soundboard.enabled &&
      (previous.soundboard.ducking !== next.soundboard.ducking ||
        previous.soundboard.duck_db !== next.soundboard.duck_db));
  const chatChanged = JSON.stringify(previous.chat) !== JSON.stringify(next.chat);
  const sinkTimeoutChanged =
    previous.sink.rw_timeout_seconds !== next.sink.rw_timeout_seconds;
  const youtubeRtmpChanged = previous.youtube.rtmp_url !== next.youtube.rtmp_url;

  return {
    videoEncoderChanged,
    videoEncodeChanged,
    overlaysChanged,
    earningsOverlayChanged,
    videoLayoutChanged,
    audioChanged,
    soundboardPipeChanged,
    chatChanged,
    sinkTimeoutChanged,
    youtubeRtmpChanged,
  };
}

export interface SettingsApplyHost {
  settings: Settings;
  deps: {
    config: LoadedConfig;
    logger: Logger;
    registerSecret?: (secret: string) => void;
  };
  buffer: DelayBuffer;
  sourceSession: SourceSession;
  sinkController: SinkController;
  outputFanout: OutputFanout;
  overlays: OverlayManager;
  overlayRuntime: OverlayRuntime;
  pauseController: PauseController;
  watchdog: Watchdog;
  autoRefresh: AutoRefresh;
  online: OnlineMonitor;
  earnings: EarningsMonitor;
  scenes: SceneStore;
  media: MediaPlaybackController;
  rtmpIngest: RtmpIngestServer;
  soundboardEngine?: SoundboardEngine;
  state: StreamState;
  activeStreamer: StreamerConfig | null;
  applyingScene: boolean;
  bufferMaxBytes: (settings: Settings) => number;
  applyConfiguredDelay: () => void;
  markSinkGrace: () => void;
  rebuildChatEngineLocked: () => void;
  restartSinkLocked: () => Promise<void>;
  screenFallbackStreamer: () => StreamerConfig;
  emitAll: () => void;
  buildStatus: () => StatusSnapshot;
}

export async function applySupervisorSettings(
  host: SettingsApplyHost,
  next: Settings,
  previous: Settings,
): Promise<StatusSnapshot> {
  host.settings = next;
  const diff = diffSettings(previous, next);
  if (diff.videoEncoderChanged) {
    setAvailableVideoEncoders(
      await probeVideoEncoders({
        ffmpegBin: host.deps.config.media.ffmpegBin,
        preferred: next.video.encoder,
        logger: host.deps.logger,
      }),
    );
  }
  configureVideoEncoder(next.video.encoder, host.deps.logger);
  host.sinkController.updateSettings(next);
  host.applyConfiguredDelay();
  host.buffer.setMaxBytes(host.bufferMaxBytes(next));
  host.watchdog.updateSettings(next);
  host.autoRefresh.updateSettings(next);
  host.online.updateSettings(next);
  host.overlays.updateSettings(next);
  host.overlayRuntime.updateSettings(next);
  host.sourceSession.updateSettings(next);
  host.pauseController.updateSettings(next);
  host.earnings.updateSettings(next);
  host.rtmpIngest?.updateSettings(next.rtmp_ingest);
  host.soundboardEngine?.updateSettings(next.soundboard);
  host.sinkController.soundboardInput = next.soundboard.enabled
    ? { fd: 5, ducking: next.soundboard.ducking, duckDb: next.soundboard.duck_db }
    : undefined;
  if (next.webhooks.url) {
    host.deps.registerSecret?.(next.webhooks.url);
  }
  if (next.webhooks.secret) {
    host.deps.registerSecret?.(next.webhooks.secret);
  }
  setGlobalStreamKeyOverride({
    enabled: next.streaming.global_key_enabled,
    key: next.streaming.global_youtube_key,
  });
  if (next.streaming.global_youtube_key) {
    host.deps.registerSecret?.(next.streaming.global_youtube_key);
  }
  const sessionActive = host.sinkController.running || host.sinkController.starting;
  await host.outputFanout.syncWithSettings(
    previous,
    next,
    sessionActive,
    host.activeStreamer?.id ?? host.media.file ?? 'stream',
  );

  const overlayCarrier =
    host.activeStreamer ??
    (host.pauseController.manualScreen || host.media.isPlaying ? host.screenFallbackStreamer() : null);
  const liveCanvasOnly =
    isBroadcastCanvasMode(previous) &&
    isBroadcastCanvasMode(next) &&
    !diff.videoEncodeChanged &&
    previous.overlays.chat.render_fps === next.overlays.chat.render_fps &&
    JSON.stringify(previous.overlays.logo) === JSON.stringify(next.overlays.logo);
  let needsSinkRestart = false;
  if (diff.earningsOverlayChanged && overlayCarrier && !diff.overlaysChanged) {
    if (!liveCanvasOnly) {
      const prepared = host.overlays.prepare();
      host.sinkController.filters = prepared.filters;
      host.sinkController.signature = host.overlayRuntime.signature(
        prepared.filters,
        host.activeStreamer ? host.overlayRuntime.engine : undefined,
        host.overlayRuntime.logo,
      );
      needsSinkRestart = true;
    }
  }

  if (diff.overlaysChanged && overlayCarrier) {
    if (!liveCanvasOnly) {
      const prepared = host.overlays.prepare();
      host.sinkController.filters = prepared.filters;
      host.rebuildChatEngineLocked();
      if (host.state === 'live' && host.activeStreamer) {
        host.overlayRuntime.startChat(host.activeStreamer, { preserveMessages: true });
      }
      needsSinkRestart = true;
    } else if (host.state === 'live' && host.activeStreamer) {
      host.overlayRuntime.startChat(host.activeStreamer, { preserveMessages: true });
    }
  }

  if (diff.videoLayoutChanged) needsSinkRestart = true;
  if (diff.audioChanged) needsSinkRestart = true;
  if (diff.soundboardPipeChanged) needsSinkRestart = true;
  if (diff.sinkTimeoutChanged) needsSinkRestart = true;
  if (diff.youtubeRtmpChanged) needsSinkRestart = true;
  if ((diff.overlaysChanged || diff.videoLayoutChanged) && !host.applyingScene) {
    host.scenes.setActiveId(null);
  }

  if (diff.chatChanged && host.activeStreamer) {
    if (host.state === 'live') {
      host.overlayRuntime.startChat(host.activeStreamer, { preserveMessages: true });
    } else if (host.state === 'paused') {
      host.overlayRuntime.stopChat();
      host.overlayRuntime.resetMessages(false);
    }
  }

  if (diff.videoEncodeChanged) {
    host.rebuildChatEngineLocked();
    needsSinkRestart = true;
  }
  const globalKeyChanged =
    previous.streaming.global_key_enabled !== next.streaming.global_key_enabled ||
    previous.streaming.global_youtube_key !== next.streaming.global_youtube_key;
  if (globalKeyChanged && host.activeStreamer) {
    const resolvedKey = resolveStreamKey(host.activeStreamer).key;
    if (resolvedKey && resolvedKey !== host.sinkController.key) {
      host.sinkController.key = resolvedKey;
      needsSinkRestart = true;
    }
  }
  if (needsSinkRestart && host.sinkController.running) await host.restartSinkLocked();
  if (diff.videoEncodeChanged && host.sourceSession.running && host.sourceSession.resolved) {
    const reencoding =
      host.activeStreamer?.video_mode === 'reencode' || !host.sourceSession.resolved.isH264;
    const resolved = host.sourceSession.resolved;
    if (reencoding && host.activeStreamer && resolved) {
      await host.sourceSession.stop();
      const timestampOffset = host.sourceSession.nextOffset();
      host.sourceSession.start(host.activeStreamer, resolved, true, timestampOffset);
      host.sourceSession.markProducerStarted(timestampOffset);
      host.markSinkGrace();
      host.applyConfiguredDelay();
    }
  }
  if (host.state === 'paused') {
    const screen = host.pauseController.startupRunning
      ? host.pauseController.screen('startup')
      : host.pauseController.pauseRunning
        ? host.pauseController.screen('pause')
        : null;
    if (screen) {
      await screen.stop();
      const timestampOffset = host.sourceSession.nextOffset();
      await screen.start(undefined, undefined, timestampOffset);
      host.sourceSession.markProducerStarted(timestampOffset);
    }
  }
  if (!next.auto_refresh.enabled) {
    host.autoRefresh.stop();
  } else if (host.activeStreamer && host.state === 'live') {
    host.autoRefresh.start();
  } else if (!host.activeStreamer) {
    host.autoRefresh.stop();
  }
  host.emitAll();
  return host.buildStatus();
}
