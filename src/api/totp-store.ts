import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { writeJsonFile } from '../utils/fs.js';
import {
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchRecoveryHash,
  renderOtpQrSvg,
  verifyTotpCode,
} from './totp.js';

export interface TotpStatus {
  enabled: boolean;
  enabled_at: string | null;
  recovery_codes_remaining: number;
  pending_setup: boolean;
}

export interface TotpSetupPayload {
  secret: string;
  otpauth_url: string;
  qr_svg: string;
  expires_in: number;
}

export interface TotpVerifyResult {
  valid: boolean;
  usedRecoveryCode: boolean;
}

interface StoredTotp {
  enabled: true;
  secret: string;
  enabledAt: string;
  recoverySalt: string;
  recoveryHashes: string[];
}

interface PendingSetup {
  secret: string;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Persistent optional TOTP 2FA store (`data/totp.json`, mode 0600).
 *
 * Setup stays in memory until confirmed with a valid code; recovery codes are
 * stored only as salted SHA-256 hashes and consumed on first use.
 */
export class TotpStore {
  private readonly path?: string;
  private readonly onSecret?: (secret: string) => void;
  private active: StoredTotp | null = null;
  private pending: PendingSetup | null = null;
  private lastAcceptedStep: number | null = null;

  constructor(path?: string, options?: { onSecret?: (secret: string) => void }) {
    this.path = path;
    this.onSecret = options?.onSecret;
    this.load();
  }

  isEnabled(): boolean {
    return this.active !== null;
  }

  status(): TotpStatus {
    this.prunePending();
    return {
      enabled: this.active !== null,
      enabled_at: this.active?.enabledAt ?? null,
      recovery_codes_remaining: this.active?.recoveryHashes.length ?? 0,
      pending_setup: this.pending !== null,
    };
  }

  beginSetup(account = 'Dashboard', issuer = 'RELAY'): TotpSetupPayload {
    const secret = generateTotpSecret();
    this.onSecret?.(secret);
    this.pending = {
      secret,
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    const otpauthUrl = buildOtpAuthUri(secret, account, issuer);
    return {
      secret,
      otpauth_url: otpauthUrl,
      qr_svg: renderOtpQrSvg(otpauthUrl),
      expires_in: Math.floor(PENDING_TTL_MS / 1000),
    };
  }

  confirmSetup(code: string, timestampMs = Date.now()): { recoveryCodes: string[] } | null {
    this.prunePending();
    if (!this.pending) return null;
    const step = verifyTotpCode(this.pending.secret, code, { timestampMs });
    if (step === null) return null;

    const recoveryCodes = generateRecoveryCodes();
    const recoverySalt = randomBytes(16).toString('hex');
    const recoveryHashes = recoveryCodes.map((entry) => hashRecoveryCode(entry, recoverySalt));

    this.active = {
      enabled: true,
      secret: this.pending.secret,
      enabledAt: new Date(timestampMs).toISOString(),
      recoverySalt,
      recoveryHashes,
    };
    this.lastAcceptedStep = step;
    this.pending = null;
    this.onSecret?.(this.active.secret);
    this.persist();
    return { recoveryCodes };
  }

  verify(code: string, timestampMs = Date.now()): TotpVerifyResult {
    if (!this.active) return { valid: true, usedRecoveryCode: false };
    const trimmed = code.trim();
    if (!trimmed) return { valid: false, usedRecoveryCode: false };

    const step = verifyTotpCode(this.active.secret, trimmed, { timestampMs });
    if (step !== null) {
      if (this.lastAcceptedStep !== null && step <= this.lastAcceptedStep) {
        return { valid: false, usedRecoveryCode: false };
      }
      this.lastAcceptedStep = step;
      return { valid: true, usedRecoveryCode: false };
    }

    const recoveryIndex = matchRecoveryHash(
      trimmed,
      this.active.recoverySalt,
      this.active.recoveryHashes,
    );
    if (recoveryIndex >= 0) {
      this.active.recoveryHashes.splice(recoveryIndex, 1);
      this.persist();
      return { valid: true, usedRecoveryCode: true };
    }

    return { valid: false, usedRecoveryCode: false };
  }

  disable(): void {
    this.active = null;
    this.pending = null;
    this.lastAcceptedStep = null;
    if (this.path && existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  private prunePending(): void {
    if (this.pending && this.pending.expiresAt <= Date.now()) {
      this.pending = null;
    }
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoredTotp>;
      if (
        raw.enabled === true &&
        typeof raw.secret === 'string' &&
        raw.secret.length >= 16 &&
        typeof raw.recoverySalt === 'string' &&
        Array.isArray(raw.recoveryHashes)
      ) {
        this.active = {
          enabled: true,
          secret: raw.secret,
          enabledAt: typeof raw.enabledAt === 'string' ? raw.enabledAt : new Date().toISOString(),
          recoverySalt: raw.recoverySalt,
          recoveryHashes: raw.recoveryHashes.filter((h): h is string => typeof h === 'string'),
        };
        this.onSecret?.(this.active.secret);
      }
    } catch {
      /* ignore corrupt totp file */
    }
  }

  private persist(): void {
    if (!this.path || !this.active) return;
    writeJsonFile(this.path, this.active);
  }
}
