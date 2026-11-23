import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebAppData {
  valid: boolean;
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  authDate?: number;
  error?: string;
}

/**
 * Validates Telegram WebApp / Mini App initData according to the official Telegram Bot API spec:
 * 1. Parameters are parsed as URL-encoded key-value pairs.
 * 2. `hash` is extracted and removed.
 * 3. Remaining keys are sorted alphabetically and concatenated into `key=value\n...`.
 * 4. Secret key = HMAC_SHA256("WebAppData", botToken).
 * 5. Calculated hash = HMAC_SHA256(secretKey, dataCheckString).
 * 6. Hashes are compared with constant-time equality check.
 * 7. Expiration (auth_date) and allowed user list are checked.
 */
export function validateTelegramWebAppData(
  initData: string,
  botToken: string,
  allowedUserIds: number[],
  maxAgeSeconds = 86400,
): TelegramWebAppData {
  if (!initData || typeof initData !== 'string' || !botToken) {
    return { valid: false, error: 'missing_params' };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
      return { valid: false, error: 'missing_hash' };
    }

    params.delete('hash');
    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys.map((key) => `${key}=${params.get(key)}`).join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const hashBuf = Buffer.from(hash, 'utf8');
    const calcBuf = Buffer.from(calculatedHash, 'utf8');
    if (hashBuf.length !== calcBuf.length || !timingSafeEqual(hashBuf, calcBuf)) {
      return { valid: false, error: 'invalid_hash' };
    }

    const authDateStr = params.get('auth_date');
    let authDate: number | undefined;
    if (authDateStr) {
      authDate = Number.parseInt(authDateStr, 10);
      if (Number.isFinite(authDate)) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (maxAgeSeconds > 0 && (nowSec - authDate > maxAgeSeconds || authDate > nowSec + 300)) {
          return { valid: false, error: 'expired' };
        }
      }
    }

    const userStr = params.get('user');
    if (!userStr) {
      return { valid: false, error: 'missing_user' };
    }

    const user = JSON.parse(userStr) as {
      id?: unknown;
      first_name?: unknown;
      last_name?: unknown;
      username?: unknown;
      language_code?: unknown;
    };
    if (!user || typeof user.id !== 'number') {
      return { valid: false, error: 'invalid_user' };
    }

    const parsedUser = {
      id: user.id,
      first_name: typeof user.first_name === 'string' ? user.first_name : undefined,
      last_name: typeof user.last_name === 'string' ? user.last_name : undefined,
      username: typeof user.username === 'string' ? user.username : undefined,
      language_code: typeof user.language_code === 'string' ? user.language_code : undefined,
    };

    if (allowedUserIds.length > 0 && !allowedUserIds.includes(parsedUser.id)) {
      return { valid: false, error: 'user_not_allowed', user: parsedUser };
    }

    return { valid: true, user: parsedUser, authDate };
  } catch {
    return { valid: false, error: 'parse_error' };
  }
}
