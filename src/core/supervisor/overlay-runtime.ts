import type { Logger } from 'pino';
import { loadImage, type Image } from '@napi-rs/canvas';
import type { Settings, StreamerConfig } from '../config/schema.js';
import type { StatusSnapshot } from '../events.js';
import { isoOrNull } from '../../utils/format.js';
import { ChatService, type ChatMessage } from '../overlays/chat-service.js';
import { ChatAnalytics, type ChatAnalyticsSnapshot } from '../overlays/chat-analytics.js';
import { ChatOverlayEngine, type ChatEarningsCard } from '../overlays/chat-engine.js';
import { LogoOverlayEngine } from '../overlays/logo-engine.js';
import type { OverlayManager } from '../overlays/overlay-manager.js';
import { renderStudioPreview, type PreviewAspect } from '../overlays/studio-preview.js';
import {
  formatEarningsOverlay,
  type EarningsMonitor,
  type EarningsSnapshot,
} from '../earnings/monitor.js';

export interface OverlayRuntimeDeps {
  settings: Settings;
  overlays: OverlayManager;
  earnings: EarningsMonitor;
  logger: Logger;
  logoPath: string;
}

export interface RebuiltOverlayEngine {
  engine?: ChatOverlayEngine;
  logo?: LogoOverlayEngine;
  panel?: ChatOverlayEngine['panel'];
  logoPanel?: LogoOverlayEngine['panel'];
  signature: string;
}

/** Owns chat lifecycle, overlay-engine signatures and preview rendering. */
export class OverlayRuntime {
  private settings: Settings;
  private readonly overlays: OverlayManager;
  private readonly earnings: EarningsMonitor;
  private readonly logger: Logger;
  private readonly logoPath: string;

  private chat?: ChatService;
  private chatEngine?: ChatOverlayEngine;
  private logoEngine?: LogoOverlayEngine;
  private logoImage?: Image;
  private previewEngine?: ChatOverlayEngine;
  private previewEngineDirty = true;
  private currentMessages: ChatMessage[] = [];
  private lastMessageAt: Date | null = null;
  private lastValidEarningsCard: ChatEarningsCard | null = null;
  private currentStreamer: StreamerConfig | null = null;
  private readonly analytics = new ChatAnalytics();

  constructor(deps: OverlayRuntimeDeps) {
    this.settings = deps.settings;
    this.overlays = deps.overlays;
    this.earnings = deps.earnings;
    this.logger = deps.logger;
    this.logoPath = deps.logoPath;
  }

  /** Loads the built-in RELAY logo once; failures simply disable the overlay. */
  async loadLogo(): Promise<void> {
    try {
      this.logoImage = await loadImage(this.logoPath);
    } catch {
      this.logoImage = undefined;
    }
  }

  updateSettings(settings: Settings): void {
    const chatChanged =
      this.settings.overlays.chat !== settings.overlays.chat ||
      this.settings.video.resolution !== settings.video.resolution;
    this.settings = settings;
    if (chatChanged) {
      this.previewEngineDirty = true;
    }
    this.chatEngine?.setEarningsCard(this.currentEarningsCard());
  }

  updateEarnings(snapshot: EarningsSnapshot | null): void {
    this.chatEngine?.setEarningsCard(this.buildEarningsCard(snapshot));
  }

  get engine(): ChatOverlayEngine | undefined {
    return this.chatEngine;
  }

  get logo(): LogoOverlayEngine | undefined {
    return this.logoEngine;
  }

  get chatRunning(): boolean {
    return Boolean(this.chat);
  }

  setStreamer(streamer: StreamerConfig | null): void {
    this.currentStreamer = streamer;
    const info = streamer ? { name: streamer.name, tiktok: streamer.tiktok, status: 'LIVE' } : null;
    this.chatEngine?.setStreamer(info);
    this.previewEngine?.setStreamer(info);
  }

  createEngine(): ChatOverlayEngine | undefined {
    const chat = this.settings.overlays.chat;
    if (!chat.enabled || chat.engine !== 'canvas') return undefined;
    const engine = new ChatOverlayEngine({
      settings: this.settings,
      overlays: this.settings.overlays,
      logger: this.logger,
    });
    engine.setEarningsCard(this.currentEarningsCard());
    if (this.currentStreamer) {
      engine.setStreamer({
        name: this.currentStreamer.name,
        tiktok: this.currentStreamer.tiktok,
        status: 'LIVE',
      });
    }
    return engine;
  }

  createLogoEngine(): LogoOverlayEngine | undefined {
    if (!this.settings.overlays.logo.enabled || !this.logoImage) return undefined;
    return new LogoOverlayEngine({
      settings: this.settings,
      image: this.logoImage,
      logger: this.logger,
    });
  }

  signature(
    filters: string[],
    engine: ChatOverlayEngine | undefined,
    logoEngine?: LogoOverlayEngine,
  ): string {
    const chat = this.settings.overlays.chat;
    const engineSpec = engine ? JSON.stringify(engine.panel) : 'off';
    const logoSpec = logoEngine ? JSON.stringify(logoEngine.panel) : 'off';
    return `${filters.join('|')}|chat:${chat.enabled ? chat.engine : 'off'}:${engineSpec}|logo:${logoSpec}|style:${chat.style}`;
  }

  replaceEngine(engine?: ChatOverlayEngine, logoEngine?: LogoOverlayEngine): void {
    this.chatEngine?.stop();
    this.chatEngine = engine;
    this.logoEngine?.stop();
    this.logoEngine = logoEngine;
  }

  adoptEngine(
    engine: ChatOverlayEngine | undefined,
    logoEngine: LogoOverlayEngine | undefined,
    stream: NodeJS.WritableStream | null,
    logoStream: NodeJS.WritableStream | null,
  ): void {
    // Never stop/detach an already-attached engine on a reused sink: detach()
    // calls stream.end() on fd 3 / fd 4, which would permanently close the
    // running ffmpeg pipe. Only adopt engines that were missing.
    if (!this.chatEngine && engine) {
      this.chatEngine = engine;
      this.chatEngine.setMessages(this.currentMessages);
      this.chatEngine.attach(stream);
    }
    if (!this.logoEngine && logoEngine) {
      this.logoEngine = logoEngine;
      this.logoEngine.attach(logoStream);
    }
  }

  rebuildEngine(filters: string[], hasCarrier: boolean): RebuiltOverlayEngine {
    this.chatEngine?.detach();
    this.logoEngine?.detach();
    this.chatEngine = hasCarrier ? this.createEngine() : undefined;
    this.logoEngine = this.createLogoEngine();
    if (this.chatEngine) {
      this.chatEngine.setMessages(this.currentMessages);
      this.chatEngine.setEarningsCard(this.currentEarningsCard());
    }
    return {
      engine: this.chatEngine,
      logo: this.logoEngine,
      panel: this.chatEngine?.panel,
      logoPanel: this.logoEngine?.panel,
      signature: this.signature(filters, this.chatEngine, this.logoEngine),
    };
  }

  attachToSink(
    stream: NodeJS.WritableStream | null,
    logoStream: NodeJS.WritableStream | null,
  ): void {
    this.chatEngine?.attach(stream);
    this.chatEngine?.setMessages(this.currentMessages);
    this.logoEngine?.attach(logoStream);
  }

  detachEngine(): void {
    this.chatEngine?.detach();
    this.logoEngine?.detach();
  }

  stopEngine(): void {
    this.chatEngine?.stop();
    this.chatEngine = undefined;
    this.logoEngine?.stop();
    this.logoEngine = undefined;
  }

  resetMessages(resetLastMessageAt = true, updateOverlayText = true): void {
    this.currentMessages = [];
    this.analytics.reset();
    if (resetLastMessageAt) this.lastMessageAt = null;
    this.chatEngine?.setMessages([]);
    if (updateOverlayText) this.overlays.updateChat([]);
  }

  startChat(streamer: StreamerConfig, options: { preserveMessages?: boolean } = {}): void {
    const preserve = options.preserveMessages ?? false;
    this.currentStreamer = streamer;
    this.chatEngine?.setStreamer({
      name: streamer.name,
      tiktok: streamer.tiktok,
      status: 'LIVE',
    });
    this.chat?.stop(!preserve);
    if (!preserve) {
      this.currentMessages = [];
      this.analytics.reset();
      this.lastMessageAt = null;
      this.chatEngine?.setMessages([]);
      this.overlays.updateChat([]);
    }
    this.chat = new ChatService({
      streamer,
      chat: this.settings.overlays.chat,
      settings: this.settings,
      logger: this.logger,
      onMessages: (messages) => {
        this.currentMessages = messages;
        this.analytics.record(messages);
        if (messages.length > 0) this.lastMessageAt = new Date();
        this.chatEngine?.setMessages(messages);
        this.overlays.updateChat(
          messages.map((message) => `${message.displayName || message.username}: ${message.text}`),
        );
      },
    });
    this.chat.start();
  }

  stopChat(clear = true): void {
    this.chat?.stop(clear);
    this.chat = undefined;
    if (clear) {
      this.currentStreamer = null;
      this.chatEngine?.setStreamer(null);
    }
  }

  ensureChat(streamer: StreamerConfig): void {
    if (!this.chat) this.startChat(streamer);
  }

  addTestMessage(username: string, text: string): ChatMessage[] {
    if (this.chat) {
      return this.chat.injectMessage(username, text);
    }
    const engine = this.chatEngine ?? this.getPreviewEngine();
    const messages = engine.addLocalMessage(username, text);
    this.currentMessages = messages;
    this.analytics.record(messages);
    this.lastMessageAt = new Date();
    this.overlays.updateChat(
      messages.map((message) => `${message.displayName || message.username}: ${message.text}`),
    );
    return messages;
  }

  recentMessages(): ChatMessage[] {
    return this.currentMessages.map((message) => ({ ...message }));
  }

  chatAnalytics(): ChatAnalyticsSnapshot {
    return this.analytics.snapshot();
  }

  previewPng(sample = false): Buffer {
    return (this.chatEngine ?? this.getPreviewEngine()).previewPng(sample);
  }

  studioPreviewPng(
    overlays: Settings['overlays'],
    sample = true,
    maxDimension = 720,
    chatMessages?: ChatMessage[],
    earningsDraft?: Partial<Settings['earnings']>,
    videoLayoutDraft?: Partial<Settings['video']['layout']>,
    videoAspect?: PreviewAspect,
  ): Buffer {
    const settings = {
      ...this.settings,
      video: videoLayoutDraft
        ? { ...this.settings.video, layout: { ...this.settings.video.layout, ...videoLayoutDraft } }
        : this.settings.video,
      earnings: earningsDraft
        ? { ...this.settings.earnings, ...earningsDraft }
        : this.settings.earnings,
    };
    return renderStudioPreview({
      settings,
      overlays,
      logger: this.logger,
      sample,
      chatMessages,
      logoImage: this.logoImage,
      earningsText: this.studioEarningsText(settings, sample),
      earningsCard: this.currentEarningsCard(),
      maxDimension,
      videoAspect,
    });
  }

  earningsOverlayText(): string {
    const snapshot = this.earnings.get();
    this.chatEngine?.setEarningsCard(this.buildEarningsCard(snapshot));
    return formatEarningsOverlay(
      this.settings.earnings.overlay_template,
      snapshot,
      this.settings.earnings,
    );
  }

  private currentEarningsCard(): ChatEarningsCard | null {
    return this.buildEarningsCard(this.earnings.get());
  }

  private buildEarningsCard(snapshot: EarningsSnapshot | null): ChatEarningsCard | null {
    if (!snapshot || !snapshot.enabled || !snapshot.configured) {
      this.lastValidEarningsCard = null;
      return null;
    }
    if (snapshot.net === null && snapshot.gross === null && snapshot.coins === null) {
      return this.lastValidEarningsCard;
    }
    const card: ChatEarningsCard = {
      periodLabel: snapshot.period_label || snapshot.period || 'Heute',
      currency: snapshot.currency,
      net: snapshot.net,
      gross: snapshot.gross,
      coins: snapshot.coins,
      goalAmount: this.settings.earnings.goal_amount,
      goalLabel: this.settings.earnings.goal_label,
    };
    this.lastValidEarningsCard = card;
    return card;
  }

  chatStatus(): StatusSnapshot['chat'] {
    const chat = this.settings.overlays.chat;
    return {
      enabled: Boolean(chat?.enabled),
      engine: chat?.engine ?? null,
      messages: this.currentMessages.length,
      last_message_at: isoOrNull(this.lastMessageAt),
      api_configured: Boolean(chat?.api_url || this.settings.chat.api_url),
      canvas_active: Boolean(this.chatEngine),
    };
  }

  private getPreviewEngine(): ChatOverlayEngine {
    if (!this.previewEngine || this.previewEngineDirty) {
      this.previewEngine = new ChatOverlayEngine({
        settings: this.settings,
        overlays: this.settings.overlays,
        logger: this.logger,
      });
      this.previewEngineDirty = false;
    }
    return this.previewEngine;
  }

  private studioEarningsText(settings: Settings, sample: boolean): string {
    const current = this.earnings.get() ?? null;
    if (current && (current.net !== null || current.gross !== null || current.coins !== null)) {
      return formatEarningsOverlay(settings.earnings.overlay_template, current, settings.earnings);
    }
    if (!sample) return '';
    const demo = {
      ...current,
      period: settings.earnings.period,
      period_label: 'Heute',
      net: 205.28,
      gross: 410.64,
      coins: 42505,
      viewers: 344,
      followers: 76800,
      gifts: 42,
      gifts_sent: 77,
      gifters: 12,
      currency: 'EUR',
      display_name: 'Beispiel',
      streamer_name: 'Beispiel',
      streamer_handle: 'beispiel',
      is_live: true,
      session: {
        id: null,
        started_at: null,
        ended_at: null,
        status: 'active',
        peak_viewers: 400,
        last_fan_tickets: 120,
        coins: 2000,
        gifts: 4,
        net: 12.4,
        gross: 24.8,
        currency: 'EUR',
      },
      top_gift: { name: 'Money Gun', coins: 6000, count: 2 },
      top_gifter: { username: 'viewer', display_name: null, coins: 1200 },
      last_seen_at: new Date().toISOString(),
    } as EarningsSnapshot;
    return formatEarningsOverlay(settings.earnings.overlay_template, demo, settings.earnings);
  }
}
