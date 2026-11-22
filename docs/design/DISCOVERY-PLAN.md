# Implementierungsplan: Stream Discovery (#65 = #69 + #70)

Kurz-Spezifikation für den ausführenden Agenten. `#65` ist das Umbrella-Issue und schließt nach Umsetzung von **#69 (Backend/Service)** und **#70 (Dashboard-UI)**.

---

## Architektur-Regeln & Invarianten (Pflicht)

1. **Add-Flow-Guard:** `POST /api/discovery/add` legt Streamer **immer** mit `enabled: false`, `priority: 999`, `auto_start: false`, `preferred: false`, `source: 'discovery'` an. Discovery darf niemals Auto-Start, Playlist-Advance oder Preferred-Takeover triggern.
2. **Hard 18+/Verifizierungs-Filter im Service:** Hits mit `age_restricted === true` / Adult-Flags werden im Service vor Cache & Rückgabe herausgefiltert (nicht erst in der UI).
3. **Fehlertolerante Provider-Kette:** `403`/`429`/Timeout markiert nur den jeweiligen Provider als `offline` bzw. `rate_limited` (mit Backoff/Jitter) und fällt auf den nächsten Tier zurück. Die API wirft keinen 500er, sondern liefert `{ hits, providers }`.
4. **Live-Check vor Queue/Switch:** Vor `POST /api/discovery/queue` (und vor „Jetzt umschalten") erfolgt ein frischer `roomInfo(handle)`-Check (max. 60 s alt). Ist der Kanal offline → `409 ConflictError` mit klarem Hinweis statt blindem Queuing.
5. **Kein Polling-Storm:** Das Backend emittiert bei Cache-Updates ein einziges `discovery`-SSE-Event über `EventBus`. Das Frontend pollt nicht im Hintergrund und pausiert bei `document.hidden`.
6. **Kein echter TikTok-Traffic in Tests:** Alle Parser als pure Functions gegen anonymisierte JSON/HTML-Fixtures testen.

---

## Phase 1: Backend & Discovery-Service (#69)

### 1. Schema & Konfiguration (`src/core/config/schema.ts`)
- **`StreamerFieldsSchema` erweitern:** optionales Feld `source: z.enum(['manual', 'discovery']).optional()` (ebenso in `StreamerView` in `src/core/store/streamer-store.ts` durchreichen).
- **`DiscoverySettingsSchema` ergänzen** und in `SettingsSchema` unter `discovery` einhängen:
  ```ts
  export const DISCOVERY_PROVIDERS = ['live_page', 'room_info', 'search_api'] as const;
  export const DiscoverySettingsSchema = z.object({
    enabled: z.boolean().default(true),
    providers: z.array(z.enum(DISCOVERY_PROVIDERS)).default(['live_page', 'room_info', 'search_api']),
    cache_seconds: z.number().int().min(15).max(600).default(90),
    region: z.string().min(2).max(8).default('DE'),
    language: z.string().min(2).max(8).default('de'),
  });
  ```
- **Typ-Parität:** `src/web/src/api/types.ts` synchron um `DiscoverySettings`, `DiscoveryHit`, `DiscoveryProviderStatus`, `DiscoveryResponse` ergänzen (`tests/type-parity.test.ts` beachten!).

### 2. Provider-Contract & Adapter (`src/core/source/discovery/`)
- **`types.ts`:**
  ```ts
  export type DiscoveryProviderState = 'online' | 'offline' | 'rate_limited';
  export interface DiscoveryProviderStatus {
    name: string;
    status: DiscoveryProviderState;
    last_error: string | null;
    last_ok_at: string | null;
  }
  export interface DiscoveryHit {
    handle: string;          // normalisiert ohne '@'
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
    title: string | null;
    live: boolean;
    viewers: number | null;
    age_restricted?: boolean;
    source: string;          // Provider-Name
    fetched_at: string;      // ISO-8601
  }
  export interface DiscoveryProvider {
    readonly name: string;
    search?(q: string, opts: { limit: number; region?: string }): Promise<DiscoveryHit[]>;
    trending?(opts: { region?: string; language?: string; limit: number }): Promise<DiscoveryHit[]>;
    roomInfo?(handle: string): Promise<DiscoveryHit | null>;
    health(): DiscoveryProviderStatus;
  }
  ```
- **Tier 1 – `live-page-provider.ts` (`live_page`):**
  - Fetcht `https://www.tiktok.com/live` mit `AbortSignal.timeout(12_000)`, `User-Agent` aus `config.media.sourceUserAgent`, `Accept-Language` aus Settings.
  - Pure Parser-Funktion `parseLivePageHtml(html: string): DiscoveryHit[]` extrahiert `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">` bzw. `SIGI_STATE` und liest empfohlene Live-Räume aus.
- **Tier 2 – `room-info-provider.ts` (`room_info`):**
  - Nutzt denselben Endpunkt wie `src/core/source/resolver.ts` (`https://www.tiktok.com/api-live/user/room?aid=1988&sourceType=54&uniqueId=<handle>`), inkl. `readCookieHeader(cookiesFile)`.
  - Gemeinsame Helper (`normalizeHandle`, `readCookieHeader`) aus `resolver.ts` exportieren und wiederverwenden.
  - Pure Parser-Funktion `parseRoomInfoPayload(payload: unknown, handle: string): DiscoveryHit | null`.
  - Dient außerdem als Handle-Direktsuche in `search(q)`, wenn `q` wie ein Handle aussieht (`@handle` oder `[a-z0-9._]{2,24}`).
- **Tier 3 – `search-provider.ts` (`search_api`):**
  - Optionaler Adapter gegen `https://www.tiktok.com/api/live/search/?aid=1988&keyword=...` mit Cookie-Header aus `cookiesFile`.
  - Bei 403/Signatur-Ablehnung oder leerem Body: Status auf `offline`/`rate_limited` setzen und leer zurückgeben (kein Wurf nach außen).

### 3. Discovery-Service (`src/core/source/discovery/discovery-service.ts`)
- Verwaltet Provider-Kette gemäß `settings.discovery.providers`.
- **In-Memory TTL-Cache** (`cache_seconds` + ±10 % Jitter) für `trending` und `search(q)` sowie `roomInfo(handle)` (60 s TTL).
- **Hard-Guard:** Filtert jeden Hit mit `age_restricted === true` oder fehlendem `handle` aus.
- **Methoden:**
  - `trending(opts?)`: Iteriert Provider mit `trending`, merged/dedupliziert nach `handle`, emittiert bei Cache-Refresh `bus.emit({ type: 'discovery', data: response })`.
  - `search(q, opts?)`: Kombiniert `search_api` → Fallback Filterung auf gecachten `live_page`-Trending-Hits → falls `q` Handle-Format hat, direkter Lookup via `room_info`.
  - `roomInfo(handle, { forceFresh })`: Einzelabfrage über `room_info`.
  - `addStreamer(handle)`: Prüft Idempotenz (`store.list()` auf gleiches `tiktok`-Handle), holt optional `roomInfo` für `display_name`, ruft `store.create({ id, name, tiktok: handle, enabled: false, priority: 999, auto_start: false, preferred: false, source: 'discovery' })` auf.
  - `queueNow(handle)`: Erzwingt `roomInfo(handle, { forceFresh: true })`. Wenn `!hit || !hit.live` → `throw new ConflictError('Streamer ist aktuell nicht live')`. Legt Streamer falls noch nicht in `store` via `addStreamer(handle)` (deaktiviert) an und ruft `supervisor.queuePlayNow(streamer.id)` (bzw. Queue-Insert direkt hinter aktivem Eintrag) auf.

### 4. API-Routen, Rate-Limit, Audit & OpenAPI (`src/api/`)
- **`src/core/events.ts`:** `SystemEvent` um `| { type: 'discovery'; data: DiscoveryResponse }` erweitern; in `src/api/routes/system.ts` im SSE-Stream durchreichen.
- **`src/api/context.ts` & `src/main.ts`:** `discovery?: DiscoveryService` im `ApiContext` verdrahten.
- **`src/api/routes/discovery.ts`:**
  - Rate-Limit pro Route: `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`, bei Überschreitung Audit-Log-Eintrag (`discovery.rate_limit`).
  - `GET /api/discovery/trending?region=&limit=` → `{ hits, providers }`
  - `GET /api/discovery/search?q=&limit=` → `{ hits, providers }`
  - `GET /api/discovery/room/:handle` → `{ hit, providers }`
  - `POST /api/discovery/add` `{ handle, name? }` → `{ streamer, created: boolean }`
  - `POST /api/discovery/queue` `{ handle, mode?: 'now' | 'next' }` → `{ streamer, queue, status }`
- **`src/api/audit-middleware.ts`:**
  - `POST /api/discovery/add` → `discovery.add`
  - `POST /api/discovery/queue` → `discovery.queue`
  - `POST /api/discovery/switch` (falls eigener Endpoint, sonst über `/api/discovery/queue` mit `mode: 'now'` oder `/api/streamers/:id/switch`) → `discovery.switch`
- **`scripts/generate-openapi.ts`:** Discovery-Endpunkte & Schemas eintragen, danach `npm run openapi:generate` ausführen.

---

## Phase 2: Dashboard-UI (#70)

### 1. Navigation & Routing (`src/web/src/`)
- **`src/web/src/navigation.ts`:** Unter Sektion `inhalte` (`Inhalte`) neuen Sub-Tab ergänzen:
  `{ label: 'Discovery', to: '/discovery' }`.
- **`src/web/src/router.ts`:** Route `{ path: '/discovery', name: 'discovery', component: () => import('./views/DiscoveryView.vue'), meta: { section: 'inhalte', title: 'Discovery' } }`.
- **`src/web/src/api/client.ts` & `useStore.ts`:**
  - `api.discovery = { trending, search, room, add, queue }` ergänzen.
  - In `useStore.ts` SSE-Listener für `event: 'discovery'` registrieren.

### 2. `DiscoveryView.vue` (`src/web/src/views/DiscoveryView.vue`)
- **Header & Suchleiste:**
  - Suchfeld (`input[type="search"]`, 16 px Font gegen iOS-Zoom, Enter/Button löst `search(q)` aus) + Mode-Umschalter `Trending` / `Suche` + Live-Filter-Toggle + Refresh-Button.
  - **Provider-Status-Leiste:** Zeigt Badges für `providers` (`live_page`, `room_info`, `search_api`) mit Status (`ONLINE` grün, `OFFLINE` gedimmt/warn, `RATE-LIMITED` gelb). Kein Crash-Screen bei Provider-Ausfall.
- **Karten-Grid (TokTracker-Stil):**
  - 1-px-Border, max. 2 px Radius, Mono-Badges, fokussierbare Liste (`role="list"` / `role="listitem"`).
  - Pro Karte: Avatar (mit Fallback-Initialen und `referrerpolicy="no-referrer"`), Display-Name, `@handle`, Live-Badge (`aria-label`), Zuschauerzahl, Raum-Titel, Provider-Herkunft (`source`) sowie Markierung, falls bereits in `store.streamers` vorhanden (`IN LISTE (AUS)` / `IN LISTE (AKTIV)`).
- **Drei Quick-Actions pro Karte (Touch-Ziele ≥ 38 px):**
  1. **„Als Streamer speichern"** (`POST /api/discovery/add`): Legt Streamer deaktiviert (`enabled: false, priority: 999`) an. Zeigt Bestätigungs-Hinweis `In Liste gespeichert (deaktiviert)` mit optionalem Sekundär-Button **„Jetzt aktivieren"** (`PUT /api/streamers/:id { enabled: true }`).
  2. **„In Queue"** (`POST /api/discovery/queue`): Frischer Live-Check im Backend; bei Offline sauberer Toast/Hinweis statt Fehler-Crash.
  3. **„Jetzt umschalten"**: Ruft vorab `GET /api/discovery/room/:handle` (oder `POST /api/discovery/queue { handle, mode: 'now' }` bzw. Add + `api.streamers.switch(id)`) auf; falls offline → Hinweis-Toast.
- **Tab-Visibility (#57-Prinzip):** Keine Hintergrund-Requests wenn `document.hidden === true`; bei `visibilitychange` nur aktualisieren, wenn der letzte Stand älter als `cache_seconds` ist.

---

## Phase 3: Tests & Abschluss-Checks

1. **Unit-Tests (`tests/discovery-service.test.ts`):**
   - Pure Parser-Tests für `parseLivePageHtml` und `parseRoomInfoPayload` mit anonymisierten Fixtures (inkl. 18+-Filterung).
   - Provider-Fallback-Kette: Tier 1 wirft 403 → Tier 2 übernimmt, `providers`-Array meldet Tier 1 als `offline`.
   - Cache-TTL & Deduplizierung.
   - **Add-Flow-Guard-Test:** `addStreamer` erzeugt zwingend `enabled: false, priority: 999, auto_start: false, preferred: false, source: 'discovery'`; Supervisor-Auto-Start ignoriert den neuen Streamer.
   - **Queue-Live-Guard-Test:** Offline-Channel wird mit `ConflictError` (HTTP 409) abgewiesen; alle Aktionen + Rate-Limit-Verstöße erscheinen im `AuditLogStore`.
2. **API-/UI-Tests (`tests/discovery-routes.test.ts`):**
   - Fastify-Inject-Tests für `/api/discovery/trending`, `/search`, `/room/:handle`, `/add`, `/queue` inkl. Rate-Limit (`429`) und CSRF/Auth.
3. **Verifikation vor Commit:**
   ```bash
   npm run openapi:generate
   npm run check && npm run build
   ```
