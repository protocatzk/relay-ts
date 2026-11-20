import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/core/config/loader.js';
import { DEFAULT_SETTINGS } from '../src/core/config/schema.js';
import { EventBus } from '../src/core/events.js';
import { StreamerStore } from '../src/core/store/streamer-store.js';
import { SettingsService } from '../src/core/store/settings-service.js';
import type { Supervisor } from '../src/core/supervisor/supervisor.js';
import { buildServer } from '../src/api/server.js';
import { AuthSessionStore } from '../src/api/session-store.js';
import { TotpStore } from '../src/api/totp-store.js';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateTotpCode,
  renderOtpQrSvg,
  verifyTotpCode,
} from '../src/api/totp.js';
import { LogRing } from '../src/utils/logger.js';
import { VERSION } from '../src/version.js';

describe('TOTP core', () => {
  it('encodes and decodes Base32 cleanly', () => {
    const raw = Buffer.from('12345678901234567890', 'ascii');
    const encoded = base32Encode(raw);
    expect(encoded).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(encoded).equals(raw)).toBe(true);
  });

  it('matches RFC 6238 SHA-1 test vectors and verifies within ±1 window', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII "12345678901234567890"
    // RFC 6238 Appendix B: T=59s -> 94287082 -> last 6 digits 287082
    expect(generateTotpCode(secret, 59_000)).toBe('287082');
    expect(verifyTotpCode(secret, '287082', { timestampMs: 59_000 })).toBe(1);
    // Still valid 30 s later (window ±1)
    expect(verifyTotpCode(secret, '287082', { timestampMs: 89_000 })).toBe(1);
    // Expired 90 s later
    expect(verifyTotpCode(secret, '287082', { timestampMs: 149_000 })).toBeNull();
    expect(verifyTotpCode(secret, '000000', { timestampMs: 59_000 })).toBeNull();
  });

  it('builds otpauth URI and renders a valid SVG QR code', () => {
    const uri = buildOtpAuthUri('JBSWY3DPEHPK3PXP', 'Dashboard', 'RELAY');
    expect(uri).toContain('otpauth://totp/RELAY:Dashboard?');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    const svg = renderOtpQrSvg(uri);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('persists TOTP config with mode 0600 and enforces single-use recovery codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-totp-store-'));
    const file = join(dir, 'totp.json');
    const store = new TotpStore(file);

    const setup = store.beginSetup();
    const now = 1_700_000_000_000;
    expect(store.confirmSetup('000000', now)).toBeNull();
    expect(store.isEnabled()).toBe(false);

    const validCode = generateTotpCode(setup.secret, now);
    const enabled = store.confirmSetup(validCode, now);
    expect(enabled).not.toBeNull();
    expect(enabled!.recoveryCodes).toHaveLength(8);
    expect(store.isEnabled()).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    // Reload from disk and test single-use recovery code.
    const reloaded = new TotpStore(file);
    expect(reloaded.isEnabled()).toBe(true);
    const firstRecovery = enabled!.recoveryCodes[0]!;
    expect(reloaded.verify(firstRecovery.toLowerCase().replace('-', ' '), now + 60_000)).toEqual({
      valid: true,
      usedRecoveryCode: true,
    });
    expect(reloaded.status().recovery_codes_remaining).toBe(7);

    // Second attempt with the same recovery code must fail.
    expect(reloaded.verify(firstRecovery, now + 60_000)).toEqual({
      valid: false,
      usedRecoveryCode: false,
    });
  });
});

describe('TOTP API routes', () => {
  let app: FastifyInstance;
  let totp: TotpStore;
  let existingCookie = '';

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-totp-api-'));
    const logger = pino({ level: 'silent' });
    const config = loadConfig({
      cwd: dir,
      env: { DASHBOARD_PASSWORD: 'secret', API_TOKEN: 'api-secret', LOG_LEVEL: 'silent' },
    });
    const store = new StreamerStore(
      config.paths.streamersFile,
      { streamers: [], playlists: [] },
      logger,
    );
    const settingsService = new SettingsService(config.paths.settingsFile, DEFAULT_SETTINGS, logger);
    totp = new TotpStore(join(dir, 'totp.json'));
    const supervisor = {
      buildStatus: () => ({ state: 'idle', version: VERSION }),
      streamersView: () => [],
      playlistsView: () => [],
    } as unknown as Supervisor;
    app = await buildServer({
      config,
      logger,
      store,
      settingsService,
      supervisor,
      bus: new EventBus(),
      ring: new LogRing(),
      version: VERSION,
      authSessions: new AuthSessionStore(),
      totp,
    });
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    existingCookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires TOTP once enabled, accepts recovery code once, preserves existing sessions, and disables only with password', async () => {
    const initialStatus = await app.inject({
      method: 'GET',
      url: '/api/auth/totp',
      headers: { cookie: existingCookie },
    });
    expect(initialStatus.statusCode).toBe(200);
    expect(initialStatus.json()).toMatchObject({
      enabled: false,
      password_configured: true,
      recovery_codes_remaining: 0,
    });

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/totp/setup',
      headers: { cookie: existingCookie, origin: 'http://localhost' },
    });
    expect(setup.statusCode).toBe(200);
    const setupBody = setup.json() as { secret: string; otpauth_url: string; qr_svg: string };
    expect(setupBody.secret.length).toBeGreaterThanOrEqual(16);
    expect(setupBody.qr_svg).toContain('<svg');

    const badEnable = await app.inject({
      method: 'POST',
      url: '/api/auth/totp/enable',
      headers: { cookie: existingCookie, origin: 'http://localhost' },
      payload: { code: '000000' },
    });
    expect(badEnable.statusCode).toBe(400);

    const code = generateTotpCode(setupBody.secret);
    const enable = await app.inject({
      method: 'POST',
      url: '/api/auth/totp/enable',
      headers: { cookie: existingCookie, origin: 'http://localhost' },
      payload: { code },
    });
    expect(enable.statusCode).toBe(200);
    const enableBody = enable.json() as {
      ok: true;
      recovery_codes: string[];
      status: { enabled: boolean; recovery_codes_remaining: number };
    };
    expect(enableBody.status.enabled).toBe(true);
    expect(enableBody.recovery_codes).toHaveLength(8);

    // Status and methods endpoints never expose secrets or hashes.
    const statusAfter = await app.inject({
      method: 'GET',
      url: '/api/auth/totp',
      headers: { cookie: existingCookie },
    });
    expect(JSON.stringify(statusAfter.json())).not.toContain(setupBody.secret);
    const methods = await app.inject({ method: 'GET', url: '/api/auth/methods' });
    expect(methods.json()).toMatchObject({ totp_enabled: true });
    expect(JSON.stringify(methods.json())).not.toContain(setupBody.secret);

    // Existing session stays valid.
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: existingCookie },
    });
    expect(me.statusCode).toBe(200);

    // Login without TOTP fails with totp_required.
    const noTotp = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret' },
    });
    expect(noTotp.statusCode).toBe(401);
    expect(noTotp.json()).toMatchObject({ error: { code: 'totp_required' } });

    // Login with wrong TOTP fails.
    const wrongTotp = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret', totp_code: '999999' },
    });
    expect(wrongTotp.statusCode).toBe(401);
    expect(wrongTotp.json()).toMatchObject({ error: { code: 'invalid_totp' } });

    // Login with recovery code succeeds once and fails on reuse.
    const recovery = enableBody.recovery_codes[0]!;
    const withRecovery = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret', totp_code: recovery },
    });
    expect(withRecovery.statusCode).toBe(200);
    expect(withRecovery.json()).toMatchObject({
      ok: true,
      recovery_code_used: true,
      recovery_codes_remaining: 7,
    });

    const reuseRecovery = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret', totp_code: recovery },
    });
    expect(reuseRecovery.statusCode).toBe(401);

    // Disable requires the correct password.
    const wrongDisable = await app.inject({
      method: 'POST',
      url: '/api/auth/totp/disable',
      headers: { cookie: existingCookie, origin: 'http://localhost' },
      payload: { password: 'wrong' },
    });
    expect(wrongDisable.statusCode).toBe(401);

    const okDisable = await app.inject({
      method: 'POST',
      url: '/api/auth/totp/disable',
      headers: { cookie: existingCookie, origin: 'http://localhost' },
      payload: { password: 'secret' },
    });
    expect(okDisable.statusCode).toBe(200);
    expect(okDisable.json()).toMatchObject({ ok: true, status: { enabled: false } });

    // Password-only login works again after disabling.
    const plainLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'secret' },
    });
    expect(plainLogin.statusCode).toBe(200);
  });
});
