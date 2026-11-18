import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../utils/errors.js';

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const REQUEST_TIMEOUT_MS = 15_000;

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface OAuthErrorBody {
  error?: string;
  error_description?: string;
}

/** Raised when Google rejects the OAuth exchange or a token refresh. */
export class YouTubeAuthError extends AppError {
  readonly oauthError: string;

  constructor(oauthError: string, message: string) {
    super('youtube_auth_failed', message, 502, { oauth_error: oauthError });
    this.name = 'YouTubeAuthError';
    this.oauthError = oauthError;
  }
}

/** Errors that mean the stored grant is gone and the user must reconnect. */
export function isRevokedGrant(error: unknown): boolean {
  return error instanceof YouTubeAuthError && error.oauthError === 'invalid_grant';
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(32).toString('base64url');
}

export function buildAuthorizationUrl(
  credentials: OAuthCredentials,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', credentials.clientId);
  url.searchParams.set('redirect_uri', credentials.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  // prompt=consent guarantees a refresh token on every (re-)connect.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function postForm(endpoint: string, body: Record<string, string>): Promise<Response> {
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new YouTubeAuthError('network_error', 'Google ist nicht erreichbar.');
  }
}

async function readTokenResponse(response: Response): Promise<TokenResponse> {
  const data = (await response.json().catch(() => null)) as
    | (TokenResponse & OAuthErrorBody)
    | null;
  if (!response.ok || !data?.access_token) {
    const oauthError = data?.error ?? `http_${response.status}`;
    throw new YouTubeAuthError(
      oauthError,
      `Google hat die Anmeldung abgelehnt (${oauthError}).`,
    );
  }
  return data;
}

export async function exchangeCode(
  credentials: OAuthCredentials,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const response = await postForm(TOKEN_ENDPOINT, {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: credentials.redirectUri,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  return readTokenResponse(response);
}

export async function refreshAccessToken(
  credentials: OAuthCredentials,
  refreshToken: string,
): Promise<TokenResponse> {
  const response = await postForm(TOKEN_ENDPOINT, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  return readTokenResponse(response);
}

/** Best-effort revocation; never throws so disconnecting always succeeds locally. */
export async function revokeToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
