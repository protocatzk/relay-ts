# RELAY · Discovery-Provider-Architektur (RFC zu #65)

Design für den Discovery-Modus: automatisches Auffinden und Hinzufügen neuer
TikTok-Live-Streamer. Der Text beschreibt die Zielarchitektur für das Issue
[`#65`](https://github.com/protocatzk/relay-ts/issues/65) und wird in
Teil-Issues umgesetzt (siehe Planung).

- **Version:** 1.0 (Entwurf)
- **Gehört zu:** Issue [#65](https://github.com/protocatzk/relay-ts/issues/65),
  `src/core/source/`, `src/api/routes/`
- **Implementierungs-Issues:** [#69](https://github.com/protocatzk/relay-ts/issues/69) (Service-Grundgerüst), [#70](https://github.com/protocatzk/relay-ts/issues/70) (Dashboard-UI)

## Kurzfassung

RELAY spricht TikTok bereits heute: `resolver.ts` ruft die inoffizielle
`api-live/user/room`-API pro Handle ab (inkl. `cookiesFile`-Support). Der neue
Teil ist ausschließlich das *Suchen/Entdecken*. Kernregeln:

1. **Provider-Interface, keine hart codierte Quelle.** TikTok hat keine
   öffentliche Such-API; inoffizielle Endpunkte sterben jederzeit. Jede Quelle
   ist austauschbar, die Kette hat Fallbacks, 403/Timeout = „Provider
   offline“, nie der Stream.
2. **Stabilität zuerst.** Trending über die öffentliche `/live`-Seite (kein
   Signing), Room-Details über den bestehenden Resolver-Endpoint, Keyword-
   Suche nur als optionaler, fehlertoleranter Adapter.
3. **Discovery ändert nichts Laufendes.** Hinzufügen erfolgt immer mit
   `enabled: false`, `priority: 999` — Auto-Start, Prioritäten und
   `preferred`-Auto-Switch werden nie durch Discovery ausgelöst.
4. **Menschliche Entscheidung bleibt Pflicht.** „Jetzt umschalten“, „In
   Queue“, „Als Streamer speichern“ sind bewusste Klicks; jede Aktion landet
   im Audit-Log.

---

## 1 Ausgangslage und Randbedingungen

- Der Resolver (`src/core/source/resolver.ts`) fragt
  `https://www.tiktok.com/api-live/user/room` mit `aid=1988`,
  `sourceType=54`, `uniqueId=<Handle>` ab; Header via
  `media.sourceUserAgent`, Cookies via `cookiesFile`. Diese Bausteine wird
  Discovery wiederverwenden, nicht doppelt pflegen.
- TikTok bewahrt Such-Lives hinter Signaturparametern (`msToken`, `X-Bogus`)
  auf; die öffentliche `/live`-Seite dagegen bettet empfohlene Räume als JSON
  (`__UNIVERSAL_DATA_FOR_REHYDRATION__`) ein — per einfachem GET lesbar.
- `yt-dlp` ist ein guter Resolver pro Handle, aber keine Suchquelle; es bleibt
  Resolver-Fallback, kein Discovery-Provider.

## 2 Provider-Contract

```ts
interface DiscoveryProvider {
  name: string;
  search(q: string, opts: { limit: number }): Promise<DiscoveryHit[]>;
  trending(opts: { region?: string; limit: number }): Promise<DiscoveryHit[]>;
  roomInfo(handle: string): Promise<DiscoveryHit | null>;
  health(): { ok: boolean; lastError: string | null; lastOkAt: string | null };
}

interface DiscoveryHit {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  title: string | null;
  live: boolean;
  viewers: number | null;
  source: string;        // Provider-Name, auditiert mit
  fetched_at: string;    // ISO-8601
}
```

### Adapter (Tier-Kette)

| Tier | Provider | Quelle | Signing | Risiko |
|------|----------|--------|---------|--------|
| 1 | `LivePageProvider` | `https://www.tiktok.com/live` (eingebettetes JSON) | nein | Seitenstruktur ändert sich selten |
| 2 | `RoomInfoProvider` | `api-live/user/room` (Reuse aus `resolver.ts`) | nein | wie bestehender Resolver |
| 3 | `SearchProvider` | `api/live/search/?keyword=…` | msToken/X-Bogus | stirbt wahrscheinlich zuerst |

- **Kette:** Reihenfolge aus Settings; erster Erfolg gewinnt. 4xx/Timeout
  kennzeichnet den Provider als offline (Jitter, nicht sofort wiederholen);
  Tiernetz fällt weiter herunter. `health()` je Provider für UI.
- **Signing (Tier 3, optional):** Cookie aus bestehender `cookiesFile`
  verwenden (msToken landet dort oft mit); X-Bogus nur, wenn ohne es 403
  kommt. Bewusst wenig Energie: Dieser Adapter ist vermutlich kurzlebig und
  muss nie Pflicht sein — ohne ihn funktioniert Discovery über Tier 1+2.

## 3 Caching und Rate-Limits

- Ergebnis-Cache 60–120 s (Settingseffekt `discovery.cache_seconds`, Default
  90). Trending belastet damit max. ~2×/Minute das Netz — schont TikTok und
  die eigene IP gleichzeitig.
- `@fastify/rate-limit` auf Discovery-Routen: enger als Default (z. B.
  10 Suchen/Min pro Session), Fehler `429` mit Retry-After.
- Zeitouts konsequent per `AbortSignal.timeout` wie im Rest der Codebasis
  (Resolver 20 s, Discovery 10–15 s).

## 4 API-Fläche

```
GET  /api/discovery/search?q=…&limit=…
GET  /api/discovery/trending?region=…&limit=…
GET  /api/discovery/room/:handle
POST /api/discovery/add      { handle }        → Streamer (enabled: false, priority: 999)
POST /api/discovery/queue    { handle }        → als nächstes in Regie-Queue
```

- Rückgabe immer `{ hits, providers: { name, status }[] }`, damit die UI
  Offline-/Limit-Zustände transparent zeigen kann (AK #65).
- 18+/Verifizierungs-Filter als **Hard-Guard im Service** (nicht nur UI):
  was ohne verifizierbare Alters-/Inhaltsfelder bleibt, wird nicht
  angezeigt. Kein Pausen-/Discovery-Content landet ungewollt auf YouTube.

## 5 Add-Flow-Guard (wichtigste Invariante)

- `POST /api/discovery/add` legt den Streamer über
  `streamer-store.addStreamer` **immer** mit `enabled: false`, `priority: 999`
  und `source: 'discovery'` an. Der Supervisor-Startpfad (Auto-Start,
  Auto-Switch, Playlist-Selector) filtert auf `enabled: true` — Discovery
  kann den laufenden Stream dadurch nie unerwartet auswechseln.
- `POST /api/discovery/queue`: normalisiert über `queue-controller`
  (`file:`/`streamer`), Entry als „nächstes Ziel“; zuvor frischer
  `roomInfo`-Live-Check (falls offline in den letzten 60 s → Hinweis statt
  Queuing).
- Jede Aktion (add, queue, Suchaufrufe mit Limit-Überschreitung) in den
  `AuditLog` — Discovery-Daten sind fremde Streamer, Herkunft/Aktion muss
  nachvollziehbar bleiben.

## 6 Frontend (Teil-Issue #70)

- Eigener Tab/View (`DiscoveryView`) statt Anreicherung von `StreamersView`:
  Discovery flutet die Regie-Liste nicht unnötig mit Kandidaten.
- Karten mit Live-Badge, Zuschauerzahl, Titel, Avatar; Quick-Buttons wie im
  Issue skizziert. Live-Status via bestehenden Event-Bus (`/api/events`):
  **ein** `discovery`-Event pro Cache-Aktualisierung bedient alle offenen
  Dashboards — kein per-Client-Polling-Storm. Details nur on-demand
  (`room/:handle`), Sichtbarkeit-Prinzip wie in #57.
- Bestätigungs-Dialog beim Add: Discovery-Streamer werden per
  Default deaktiviert angelegt (siehe §5), UI zeigt klar „in Liste (aus)“.

## 7 Fehlerbilder und Degrade-Verhalten

| Fall | Verhalten |
|------|-----------|
| Provider 403/429 | Provider „offline“, Kette fällt weiter, UI zeigt Badge |
| Nur Tier-1/2 verfügbar | Trending + Handle-Checks funktionieren voll, Suche zeigt Hinweis |
| Cache leer + alle offline | `hits: []`, `providers`-Status sichtbar, kein Error-Crash in der UI |
| Handle schon in Liste | Skip im Add-Flow (Idempotenz), Toast „bereits vorhanden“ |
| TikTok-Layout-Änderung | Tier-1-Parser adapten (Fixture-Test rot), Rest bleibt unberührt |

## 8 Tests

- Parser als pure Functions mit anonymisierten Fixture-Dateien aus echten
  Responses — kein Netz in Unit-Tests (Muster wie `parseApiLivePayload`).
- Provider-Kette: Fake-Provider-Reihenfolge, Offline-Degradation,
  Cache-Verhalten, Rate-Limit-Antworten.
- Add-Flow: `enabled: false`/`priority: 999`-Invarianten als Unit-Test,
  kein Auto-Start trotz Discovery-Add.
- E2E mit Mock-Fetch (Fake-ffmpeg-Muster); CI braucht nie TikTok-Kontakt.

## 9 Risiken (ehrlich)

1. **ToS-Grauzone:** Inoffizielle Endpunkte + Scraping ist gängige Praxis
   hinter solchen Trackern, verstößt aber gegen die TikTok-Nutzungsbedingungen.
   Machbarkeit ≠ Erlaubnis — bewusster betrieblicher Risikohinweis, wie bei
   ASR (#40) der Fallback dokumentiert wird.
2. **Urheberrecht/Einwilligung:** Auto-Surfacing fremder Streamer für einen
   Restream auf YouTube hat Rechte- und Einwilligungsaspekte. Das Klick-
   Design von #65 ist richtig und bleibt Pflicht; `source: 'discovery'`
   hält Fünde auditierbar.
3. **Fragilität:** Tier 3 kann jederzeit sterben — Akzeptanz vorab, nicht
   als Bug. Provider-Abstraktion ist die Versicherung.

## 10 Umsetzungsplan

1. **#69 — Discovery-Service-Grundgerüst:** Provider-Contract + Tier-1/2,
   Cache, Rate-Limit, `add`/`queue` mit Guard, Audit-Log, Unit-Tests.
2. **#70 — Discovery-UI:** `DiscoveryView` mit Karten, Filtern,
   Provider-Status-Badges, Quick-Actions, EventBus-Anbindung, E2E.

`npm run check` bleibt in beiden Schritten grün; #65 schließt erst mit
beiden Teilen.
