import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { renderSVG } from 'uqr';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const RECOVERY_CODE_COUNT = 8;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[\s=-]+/g, '').toUpperCase();
  if (!cleaned) return Buffer.alloc(0);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Ungültiges Base32-Zeichen im TOTP-Secret');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a 160-bit (20-byte) Base32 secret per RFC 4226 / RFC 6238. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function hotpCode(secret: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x1_0000_0000);
  const low = counter >>> 0;
  counterBuf.writeUInt32BE(high, 0);
  counterBuf.writeUInt32BE(low, 4);

  const digest = createHmac('sha1', key).update(counterBuf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  const modulo = 10 ** digits;
  return String(binary % modulo).padStart(digits, '0');
}

export function totpCounter(timestampMs = Date.now(), stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(timestampMs / 1000 / stepSeconds);
}

export function generateTotpCode(
  secret: string,
  timestampMs = Date.now(),
  stepSeconds = TOTP_STEP_SECONDS,
  digits = TOTP_DIGITS,
): string {
  return hotpCode(secret, totpCounter(timestampMs, stepSeconds), digits);
}

function safeDigitsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a 6-digit TOTP code within `±window` steps.
 * Returns the matched counter step on success, or `null` on failure.
 */
export function verifyTotpCode(
  secret: string,
  input: string,
  options: { timestampMs?: number; stepSeconds?: number; digits?: number; window?: number } = {},
): number | null {
  const digits = options.digits ?? TOTP_DIGITS;
  const normalized = input.replace(/[\s-]+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return null;

  const stepSeconds = options.stepSeconds ?? TOTP_STEP_SECONDS;
  const window = options.window ?? 1;
  const current = totpCounter(options.timestampMs ?? Date.now(), stepSeconds);

  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    const expected = hotpCode(secret, step, digits);
    if (safeDigitsEqual(normalized, expected)) return step;
  }
  return null;
}

export function buildOtpAuthUri(
  secret: string,
  account = 'Dashboard',
  issuer = 'RELAY',
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function renderOtpQrSvg(uri: string): string {
  return renderSVG(uri, {
    ecc: 'M',
    border: 2,
    pixelSize: 6,
    whiteColor: '#ffffff',
    blackColor: '#111827',
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(8);
    let raw = '';
    for (const byte of bytes) {
      raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string, salt: string): string {
  const normalized = normalizeRecoveryCode(code);
  return createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
}

export function matchRecoveryHash(
  code: string,
  salt: string,
  hashes: readonly string[],
): number {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 6) return -1;
  const candidate = Buffer.from(hashRecoveryCode(normalized, salt), 'hex');
  let matchedIndex = -1;
  for (let i = 0; i < hashes.length; i += 1) {
    const stored = Buffer.from(hashes[i]!, 'hex');
    if (stored.length === candidate.length && timingSafeEqual(candidate, stored)) {
      matchedIndex = i;
    }
  }
  return matchedIndex;
}
