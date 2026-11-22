import type { DiscoverySettings } from '../../config/schema.js';

export type DiscoveryProviderName = 'live_page' | 'room_info' | 'search_api' | 'following';
export type DiscoveryProviderState = 'online' | 'offline' | 'rate_limited';

export interface DiscoveryProviderStatus {
  name: string;
  status: DiscoveryProviderState;
  last_error: string | null;
  last_ok_at: string | null;
}

export interface DiscoveryHit {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  cover_url?: string | null;
  bio: string | null;
  title: string | null;
  live: boolean;
  viewers: number | null;
  age_restricted?: boolean;
  source: string;
  fetched_at: string;
}

export interface DiscoveryResponse {
  hits: DiscoveryHit[];
  providers: DiscoveryProviderStatus[];
  fetched_at: string;
}

export interface DiscoveryProvider {
  readonly name: string;
  search?(q: string, opts?: { limit?: number; region?: string; page?: number }): Promise<DiscoveryHit[]>;
  trending?(opts?: { region?: string; language?: string; limit?: number; page?: number }): Promise<DiscoveryHit[]>;
  roomInfo?(handle: string): Promise<DiscoveryHit | null>;
  following?(opts?: { limit?: number; page?: number }): Promise<DiscoveryHit[]>;
  health(): DiscoveryProviderStatus;
}

export type { DiscoverySettings };
