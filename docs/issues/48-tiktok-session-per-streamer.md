# TikTok-Session pro Streamer festlegen

## Ziel

Jeder Streamer kann ein **eigenes TikTok-Konto** (Session-Cookie) nutzen.
Quellauflösung, Chat-Webcast und Online-Checks laufen mit der Session, die für
den Streamer hinterlegt ist — nicht mehr mit dem einen global aktiven Konto.
Der globale Kontowechsel bleibt für Discovery und Following zuständig, fasst
zugeordnete Streamer aber nicht mehr an.

## Ausgangslage (geprüft an 0.35.3)

- `TikTokAccountStore` (`data/tiktok-accounts.json`, Modus `0600`) hält mehrere
  Konten mit `sessionId` und `targetIdc`; genau eines ist `active`.
- `ensureCookieFile()` schreibt beim Anlegen/Aktivieren ausschließlich die
  globale Datei `data/cookies.txt` (Modus `0600`).
- Alle TikTok-Zugriffe lesen diese eine Datei bzw. das aktive Konto:
  - `TikTokResolver` (`src/core/source/resolver.ts`): yt-dlp `--cookies` und
    der `apiLive`-Fallback (`readCookieHeader`),
  - `OverlayRuntime.startChat(streamer)` → `ChatService` →
    `WebcastLiveRoomClient` (`src/core/overlays/chat-service.ts`,
    `src/core/source/webcast/live-room-client.ts`),
  - `OnlineMonitor.pollTikTok()` (`src/core/online/monitor.ts`) über
    `settings.online.account_id` bzw. die globale Cookie-Datei,
  - Discovery (`RoomInfoProvider`, `SearchProvider`, `FollowingProvider`).
- Folgen: Ein Kontowechsel wirkt mitten im Stream auf **alle** Streamer;
  Follow-/Region-/Altersbeschränkungen gelten nur für das eine Konto;
  parallele Streamer teilen sich Rate-Limits; Streamer, die zwingend ein
  bestimmtes Konto brauchen, lassen sich nicht sauber trennen.

## Vorschlag

Neues Streamer-Feld `tiktok_account` (ID aus `tiktok-accounts.json`, leer =
aktives Konto). Die Secrets bleiben ausschließlich im Account-Store: keine
Session in `streamers.yml`, keiner API-Antwort und keinem Log.

Verworfen: Session direkt am Streamer speichern. Das dupliziert das
Secret-Handling, verhindert Wiederverwendung und macht den Kontowechsel im
Dashboard inkonsistent.

## Umfang

### Datenmodell & Persistenz

- `StreamerFieldsSchema.tiktok_account` (`z.string().max(64).default('')`),
  `StreamerUpdateSchema`, `StreamerStore`, API-/Frontend-Typen und
  `docs/openapi.json` ergänzen.
- `data/streamers.yml` speichert nur die ID, nie den Cookie.
- Cookie-Dateien pro Konto: `data/cookies/<accountId>.txt` (Modus `0600`,
  Verzeichnis gitignored), lazy beim ersten Bedarf erzeugt und bei
  Session-/`targetIdc`-Änderung neu geschrieben; beim Löschen des Kontos
  entfernt.
- Migration: fehlendes Feld = `''` = bisheriges Verhalten (aktives Konto).

### Auflösung

- Resolver-Deps von festem `cookiesFile` auf `cookieFileFor(streamer)` /
  `cookieFor(streamer)` umstellen; `buildResolveArgs` bekommt die konkrete
  Datei, der `apiLive`-Header nutzt dieselbe Session.
- Fallback-Kette: Streamer-Konto → (nur Online-Checks)
  `settings.online.account_id` → aktives Konto → `data/cookies.txt`.
- Unbekannte oder entfernte ID: einmalige Warnung beim Start, Fallback auf das
  aktive Konto; der Stream startet weiter (kein harter Fehler).

### Chat & Online

- `OverlayRuntime.startChat(streamer)` übergibt die Cookie-Datei des Streamers
  an `ChatService`/`WebcastLiveRoomClient` (Chat und Zuschauerzahl laufen
  damit unter demselben Konto wie die Quelle).
- `OnlineMonitor.pollTikTok()` löst das Konto **pro Streamer** auf; die
  vorhandene `accountCookie(accountId)`-Injektion wird wiederverwendet.
- Discovery und Following bleiben am aktiven Konto (kein Streamer-Bezug) und
  werden im UI entsprechend beschriftet.

### API & Validierung

- `POST /api/streamers` und `PUT /api/streamers/:id` akzeptieren
  `tiktok_account`; unbekannte ID → `422` mit klarer Meldung.
- Antworten liefern `tiktok_account`, `tiktok_account_label` und
  `tiktok_account_missing` (bool) — niemals `sessionId`/`targetIdc`.
- `DELETE /api/discovery/accounts/:id` antwortet mit `409` und der Liste der
  zugewiesenen Streamer, solange Referenzen bestehen; optional
  `?reassign=active` zum Auflösen der Zuordnungen.
- Audit-Log-Eintrag bei Änderung der Zuordnung.

### UI

- Streamers-View (Bearbeiten-Dialog) und Quick-Add: Dropdown „TikTok-Konto" mit
  „Standard (aktives Konto)" plus allen Konten; Inline-Aktion „+ Konto aus
  Session anlegen" nutzt den bestehenden Account-Dialog.
- Streamer-Zeile: Badge `Konto: <Label>` nur bei expliziter Zuordnung,
  Warn-Badge bei fehlendem Konto.
- `SettingsTikTokAccountsCard`: Spalte „verwendet von N Streamern" und
  Löschhinweis.
- `DiscoveryView`: kurzer Hinweis, dass das aktive Konto nur Discovery/
  Following betrifft.

### Tests & Doku

- Unit: Schema/Update-Validierung, `buildResolveArgs` mit Streamer-Konto,
  Fallback-Kette, Löschguard, keine Secrets in API-Antworten.
- Integration: Quellenwechsel nutzt die Cookie-Datei des Streamers; Chat
  startet mit dessen Session (Fake-ffmpeg/Client).
- E2E: Konto speichern, Warnzustand bei fehlendem Konto, mobiler Dialog.
- `AGENTS.md`-Invariante (Session-Auflösung pro Streamer) und README-Abschnitt
  zu TikTok-Konten aktualisieren.

## Akzeptanzkriterien

- [ ] Ein Streamer kann im Dashboard einem TikTok-Konto zugeordnet werden
      (leer = aktives Konto).
- [ ] Quellauflösung, Chat-Webcast und Online-Checks nutzen die Session des
      Streamers.
- [ ] Ein Wechsel des global aktiven Kontos ändert zugeordnete Streamer nicht.
- [ ] Fehlendes/gelöschtes Konto: Warnung plus Fallback, der Stream startet
      weiter.
- [ ] Sessions erscheinen nie in API-Antworten, Logs oder `streamers.yml`;
      Cookie-Dateien bleiben `0600`.
- [ ] Bestehende Installationen laufen ohne Migration unverändert.
- [ ] `npm run check`, `npm run build` und `npm run test:e2e` sind grün.

## Abgrenzungen

- Keine automatische Rotation oder Rate-Limit-Verteilung über Konten.
- Kein Login (QR/Passwort), weiterhin Session-Cookie.
- Discovery/Following bleibt am aktiven Konto.
- Keine Änderungen an YouTube-Auth oder Stream-Key-Logik.

## Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Session-Cookie landet in Logs oder Fehlermeldungen | Redactor um `sessionid` erweitern, Tests auf API-Antworten und Logs |
| Viele Cookie-Dateien sammeln sich an | Lazy erzeugen, beim Löschen des Kontos entfernen, Modus `0600` |
| Falsche Zuordnung führt zu Offline-Stream | Live-Check vor dem Start, Fallback mit Warnung statt Abbruch |
| Verwaiste Konto-IDs nach Löschen | `tiktok_account_missing`, Warnung im UI, Guard beim Löschen |
