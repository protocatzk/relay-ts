## Ziel

Aufbau des Discovery-Services als Grundgerüst zu #65: Provider-Contract, Tier-1/2-Adapter, Cache, Rate-Limits und der Add-/Queue-Flow mit Supervisor-Guard. Die UI folgt in einem eigenen Schritt — dieser Issue macht Discovery rein backend-seitig nutzbar.

## Hintergrund

- Design: [`docs/design/DISCOVERY-PROVIDERS.md`](../design/DISCOVERY-PROVIDERS.md).
- RELAY spricht TikTok bereits heute: `resolver.ts` fragt `api-live/user/room` pro Handle ab (`src/core/source/resolver.ts:241`, inkl. `media.sourceUserAgent` + `cookiesFile`). Neu ist nur die Such-/Trending-Ebene.
- TikTok hat keine öffentliche Such-API; inoffizielle Endpunkte (msToken/X-Bogus) sind kurzlebig. Die Architektur setzt deshalb auf eine Provider-Kette mit Fallbacks statt einer hart codierten Quelle.

## Umfang

- **Provider-Contract (`src/core/source/discovery/`):**
  - `DiscoveryProvider`-Interface (`search`, `trending`, `roomInfo`, `health`) mit `DiscoveryHit`-Objekten (Handle, Display-Name, Avatar, Titel, Live-Status, Viewer, `source`, `fetched_at`).
  - Tier 1 `LivePageProvider`: Trending aus der öffentlichen `/live`-Seite (eingebettetes JSON-Payload, kein Signing).
  - Tier 2 `RoomInfoProvider`: Room-Details über den bestehenden `api-live/user/room`-Path (Code-Reuse aus `resolver.ts`).
  - Tier 3 `SearchProvider`: `api/live/search` als **optionaler** Adapter; Ausbleibende oder abgelehnte Anfragen wegen Signaturparametern sind einkalkuliert und machen die Kette nicht kaputt (Fallspezifikation im Design §7).
- **Service (`src/core/source/discovery/discovery-service.ts`):**
  - Provider-Kette mit Fallback-Reihenfolge aus Settings; 403/Timeout = Provider offline (`health()`), nächster Tier übernimmt.
  - Ergebnis-Cache (Default 90 s, konfigurierbar über `discovery.cache_seconds`), Jitter gegen gleichzeitige Refreshes.
  - 18+/Verifizierungs-Filter als Hard-Guard im Service, nicht nur in der UI.
- **API (`src/api/routes/discovery.ts`):**
  - `GET /api/discovery/search?q=…`, `GET /api/discovery/trending`, `GET /api/discovery/room/:handle`.
  - Rückgabe immer `{ hits, providers: { name, status }[] }` — Offline-/Limit-Zustände transparent.
  - `@fastify/rate-limit` enger als Default (z. B. 10/min pro Session); Timeout via `AbortSignal.timeout` wie im Rest der Codebasis.
- **Add-Flow-Guard:**
  - `POST /api/discovery/add`: Streamer **immer** mit `enabled: false`, `priority: 999`, `source: 'discovery'` anlegen — Auto-Start, Prioritätenlogik und `preferred`-Auto-Switch werden nie ausgelöst.
  - `POST /api/discovery/queue`: Normalisierung über den `queue-controller`; davor frischer `roomInfo`-Live-Check (offline in den letzten 60 s → Hinweis statt Queuing).
  - Sämtliche Aktionen in den `AuditLog`.
- **Konfiguration:** Neuer `discovery`-Settings-Block (Enabled, Provider-Reihenfolge, Cache, Region/Sprach-Filter); Doku in README/AGENTS ergänzen.

## Akzeptanzkriterien

- [ ] Suche und Trending liefern strukturierte `DiscoveryHit`s; ohne aktives Signing funktioniert mindestens Tier-1-Trending + Room-Details.
- [ ] Ausfall eines Providers (403/Timeout) degradiert die Kette, wirft aber keinen Fehler an die API; `providers`-Status zeigt es sichtbar.
- [ ] Add legt Streamer ausschließlich mit `enabled: false`, `priority: 999` an (Unit-Test, inkl. "Auto-Start bleibt stumm").
- [ ] Alle Aktionen ebenso wie Such-Limit-Überschreitungen auditiert.
- [ ] Parser als pure Functions mit anonymisierten Fixtures getestet; CI ohne TikTok-Kontakt grün.
- [ ] `npm run check` grün.
