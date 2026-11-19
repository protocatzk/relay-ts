import type { Logger } from 'pino';
import type { Settings, StreamerConfig } from '../config/schema.js';
import type { StatusSnapshot } from '../events.js';
import { isoOrNull } from '../../utils/format.js';
import { ChatService, type ChatMessage } from '../overlays/chat-service.js';
import { ChatOverlayEngine } from '../overlays/chat-engine.js';
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
}

export interface RebuiltOverlayEngine {
  engine?: ChatOverlayEngine;
  panel?: ChatOverlayEngine['panel'];
  signature: string;
}

/** Owns chat lifecycle, overlay-engine signatures and preview rendering. */
export class OverlayRuntime {
  private settings: Settings;
  private readonly overlays: OverlayManager;
  private readonly earnings: EarningsMonitor;
  private readonly logger: Logger;

  private chat?: ChatService;
  private chatEngine?: ChatOverlayEngine;
  private previewEngine?: ChatOverlayEngine;
  private previewSignature = '';
  private currentMessages: ChatMessage[] = [];
  private lastMessageAt: Date | null = null;

  constructor(deps: OverlayRuntimeDeps) {
    this.settings = deps.settings;
    this.overlays = deps.overlays;
    this.earnings = deps.earnings;
    this.logger = deps.logger;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  get engine(): ChatOverlayEngine | undefined {
    return this.chatEngine;
  }

  get chatRunning(): boolean {
    return Boolean(this.chat);
  }

  createEngine(): ChatOverlayEngine | undefined {
    const chat = this.settings.overlays.chat;
    if (!chat.enabled || chat.engine !== 'canvas') return undefined;
    return new ChatOverlayEngine({
      settings: this.settings,
      overlays: this.settings.overlays,
      logger: this.logger,
    });
  }

  signature(filters: string[], engine: ChatOverlayEngine | undefined): string {
    const chat = this.settings.overlays.chat;
    const engineSpec = engine ? JSON.stringify(engine.panel) : 'off';
    return `${filters.join('|')}|chat:${chat.enabled ? chat.engine : 'off'}:${engineSpec}|style:${chat.style}`;
  }

  replaceEngine(engine?: ChatOverlayEngine): void {
    this.chatEngine?.stop();
    this.chatEngine = engine;
  }

  adoptEngine(engine: ChatOverlayEngine | undefined, stream: NodeJS.WritableStream | null): void {
    this.chatEngine = engine;
    this.chatEngine?.attach(stream);
  }

  rebuildEngine(filters: string[], hasActiveStreamer: boolean): RebuiltOverlayEngine | null {
    if (!hasActiveStreamer) return null;
    this.chatEngine?.detach();
    this.chatEngine = this.createEngine();
    if (this.chatEngine) this.chatEngine.setMessages(this.currentMessages);
    return {
      engine: this.chatEngine,
      panel: this.chatEngine?.panel,
      signature: this.signature(filters, this.chatEngine),
    };
  }

  attachToSink(stream: NodeJS.WritableStream | null): void {
    if (!this.chatEngine || !stream) return;
    this.chatEngine.attach(stream);
    this.chatEngine.setMessages(this.currentMessages);
  }

  detachEngine(): void {
    this.chatEngine?.detach();
  }

  stopEngine(): void {
    this.chatEngine?.stop();
    this.chatEngine = undefined;
  }

  resetMessages(resetLastMessageAt = true, updateOverlayText = true): void {
    this.currentMessages = [];
    if (resetLastMessageAt) this.lastMessageAt = null;
    this.chatEngine?.setMessages([]);
    if (updateOverlayText) this.overlays.updateChat([]);
  }

  startChat(streamer: StreamerConfig, options: { preserveMessages?: boolean } = {}): void {
    const preserve = options.preserveMessages ?? false;
    this.chat?.stop(!preserve);
    if (!preserve) {
      this.currentMessages = [];
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
    this.lastMessageAt = new Date();
    this.overlays.updateChat(
      messages.map((message) => `${message.displayName || message.username}: ${message.text}`),
    );
    return messages;
  }

  recentMessages(): ChatMessage[] {
    return this.currentMessages.map((message) => ({ ...message }));
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
      earningsText: this.studioEarningsText(settings, sample),
      maxDimension,
      videoAspect,
    });
  }

  earningsOverlayText(): string {
    return formatEarningsOverlay(this.settings.earnings.overlay_template, this.earnings.get());
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
    const signature = JSON.stringify({
      chat: this.settings.overlays.chat,
      resolution: this.settings.video.resolution,
    });
    if (!this.previewEngine || this.previewSignature !== signature) {
      this.previewEngine = new ChatOverlayEngine({
        settings: this.settings,
        overlays: this.settings.overlays,
        logger: this.logger,
      });
      this.previewSignature = signature;
    }
    return this.previewEngine;
  }

  private studioEarningsText(settings: Settings, sample: boolean): string {
    const current = this.earnings.get() ?? null;
    if (current && (current.net !== null || current.gross !== null || current.coins !== null)) {
      return formatEarningsOverlay(settings.earnings.overlay_template, current);
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
    return formatEarningsOverlay(settings.earnings.overlay_template, demo);
  }
}
