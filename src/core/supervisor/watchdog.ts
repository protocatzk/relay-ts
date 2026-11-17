import type { Logger } from 'pino';
import type { Settings } from '../config/schema.js';
import type { StreamState } from '../events.js';

export interface WatchdogSnapshot {
  state: StreamState;
  relayLastDataAt: Date | null;
  sinkRunning: boolean;
  sinkLastProgressAt: Date | null;
  sourceRunning: boolean;
  sourceStartedAt: Date | null;
  sinkStartedAt: Date | null;
  sourceBitrateKbps: number | null;
  sourceOutputSeconds: number | null;
  suppressStall: boolean;
  sinkGraceUntil: number;
}

export interface WatchdogOptions {
  settings: Settings;
  logger: Logger;
  snapshot: () => WatchdogSnapshot;
  onRelayStall: (ageSeconds: number) => void;
  onSinkDown: () => void;
  onSinkStall: (ageSeconds: number) => void;
  onLowBitrate: (kbps: number) => void;
  onLowSourceRate: (percent: number) => void;
}

/**
 * Detects stalls in the relay and the encoder. The supervisor decides how to
 * recover (re-resolve source, restart sink, fall back to a pause screen).
 */
export class Watchdog {
  private options: WatchdogOptions;
  private timer?: NodeJS.Timeout;
  private lastRelayTrigger = 0;
  private lastSinkTrigger = 0;
  private lowBitrateCount = 0;
  private lowRateCount = 0;
  private lastSourceOutput: { seconds: number; at: number } | null = null;
  private stallCount = 0;
  private lastStallAt: Date | null = null;
  private lastError: string | null = null;

  constructor(options: WatchdogOptions) {
    this.options = options;
  }

  start(): void {
    this.stop();
    const interval = Math.max(1, this.options.settings.watchdog.interval) * 1000;
    this.timer = setInterval(() => this.check(), interval);
    this.options.logger.info({ interval: interval / 1000 }, 'Watchdog gestartet');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  updateSettings(settings: Settings): void {
    const changed = this.options.settings.watchdog.interval !== settings.watchdog.interval;
    this.options.settings = settings;
    if (changed) this.start();
  }

  reset(): void {
    this.lastRelayTrigger = 0;
    this.lastSinkTrigger = 0;
    this.lowBitrateCount = 0;
    this.lowRateCount = 0;
    this.lastSourceOutput = null;
  }

  private check(): void {
    const snapshot = this.options.snapshot();
    if (snapshot.suppressStall) return;
    if (!['live', 'reconnecting', 'starting', 'paused'].includes(snapshot.state)) return;
    const now = Date.now();
    const timeoutMs = this.options.settings.watchdog.stall_timeout * 1000;

    if (snapshot.state === 'live' || snapshot.state === 'reconnecting') {
      const lastData = snapshot.relayLastDataAt ?? snapshot.sourceStartedAt;
      const relayAge = lastData ? now - lastData.getTime() : null;

      if (
        snapshot.state === 'live' &&
        snapshot.sourceOutputSeconds !== null &&
        this.options.settings.watchdog.min_source_rate_percent > 0
      ) {
        const current = { seconds: snapshot.sourceOutputSeconds, at: now };
        if (this.lastSourceOutput) {
          const deltaWall = (current.at - this.lastSourceOutput.at) / 1000;
          const deltaMedia = current.seconds - this.lastSourceOutput.seconds;
          if (deltaWall >= 5 && deltaMedia >= 0) {
            const percent = (deltaMedia / deltaWall) * 100;
            if (percent < this.options.settings.watchdog.min_source_rate_percent) {
              this.lowRateCount += 1;
              if (this.lowRateCount >= 2) {
                this.lowRateCount = 0;
                this.lastError = `Quellrate zu niedrig (${Math.round(percent)} %)`;
                this.options.logger.warn(
                  { percent: Math.round(percent), minimum: this.options.settings.watchdog.min_source_rate_percent },
                  'Watchdog: Quellrate zu niedrig',
                );
                this.options.onLowSourceRate(Math.round(percent));
                this.lastSourceOutput = current;
                return;
              }
            } else {
              this.lowRateCount = 0;
            }
          }
        }
        this.lastSourceOutput = current;
      } else {
        this.lastSourceOutput = null;
        this.lowRateCount = 0;
      }

      if (
        snapshot.state === 'live' &&
        snapshot.sourceBitrateKbps !== null &&
        snapshot.sourceBitrateKbps < this.options.settings.watchdog.min_bitrate &&
        snapshot.sourceBitrateKbps > 0
      ) {
        this.lowBitrateCount += 1;
        if (this.lowBitrateCount >= 3) {
          this.lowBitrateCount = 0;
          this.lastError = `Quell-Bitrate zu niedrig (${Math.round(snapshot.sourceBitrateKbps)} kbit/s)`;
          this.options.logger.warn(
            { kbps: snapshot.sourceBitrateKbps, minimum: this.options.settings.watchdog.min_bitrate },
            'Watchdog: Quell-Bitrate zu niedrig',
          );
          this.options.onLowBitrate(snapshot.sourceBitrateKbps);
          return;
        }
      } else {
        this.lowBitrateCount = 0;
      }

      if (relayAge !== null && relayAge >= timeoutMs && now - this.lastRelayTrigger >= timeoutMs) {
        this.lastRelayTrigger = now;
        this.stallCount += 1;
        this.lastStallAt = new Date();
        this.lastError = `Seit ${Math.round(relayAge / 1000)}s keine Daten von der Quelle`;
        this.options.logger.warn({ ageSeconds: Math.round(relayAge / 1000) }, 'Watchdog: Quellen-Stall erkannt');
        this.options.onRelayStall(Math.round(relayAge / 1000));
      }
    }

    if (snapshot.state === 'live' || snapshot.state === 'paused') {
      if (!snapshot.sinkRunning) {
        if (now - this.lastSinkTrigger >= Math.max(10_000, timeoutMs)) {
          this.lastSinkTrigger = now;
          this.lastError = 'YouTube-Sink läuft nicht';
          this.options.logger.warn('Watchdog: Sink läuft nicht');
          this.options.onSinkDown();
        }
        return;
      }
      const sinkAge = (snapshot.sinkLastProgressAt ?? snapshot.sinkStartedAt)
        ? now - (snapshot.sinkLastProgressAt ?? snapshot.sinkStartedAt)!.getTime()
        : null;
      if (now < snapshot.sinkGraceUntil) return;
      if (sinkAge !== null && sinkAge >= Math.max(timeoutMs, 30_000) && now - this.lastSinkTrigger >= Math.max(timeoutMs, 30_000)) {
        this.lastSinkTrigger = now;
        this.lastError = `Seit ${Math.round(sinkAge / 1000)}s kein Encoder-Fortschritt`;
        this.options.logger.warn({ ageSeconds: Math.round(sinkAge / 1000) }, 'Watchdog: Sink-Stall erkannt');
        this.options.onSinkStall(Math.round(sinkAge / 1000));
      }
    }
  }

  stats(): { stallCount: number; lastStallAt: Date | null; lastError: string | null } {
    return { stallCount: this.stallCount, lastStallAt: this.lastStallAt, lastError: this.lastError };
  }

  clearError(): void {
    this.lastError = null;
  }
}
