## Übersicht

Dieses Feature-Paket bündelt vier wesentliche Verbesserungen für Echtzeit-Daten, UI-Visualisierung und Account-Verwaltung in RELAY:

1. **Echtzeit Live-Room WebSocket/Webcast für Chat & Einnahmen:**
   - Statt Chat und Einnahmen (Coins/Diamonds/Gifts) ausschließlich über externe Polling-APIs (z. B. TokTracker/Chat-REST) abzufragen, sollen diese direkt über den TikTok Webcast-Echtzeitstream des aktiven Live-Rooms empfangen werden (`WebcastChatMessage`, `WebcastGiftMessage`, `RoomUserSeqMessage`).
   - Geringere Latenz, keine externen API-Abhängigkeiten oder Rate-Limits für den aktiven Stream.
   - Nahtloser Fallback auf die bestehenden API-Quellen, wenn kein direkter Webcast aktiv ist.

2. **Säulenmonitor-Overlay aufräumen und aufhübschen:**
   - Redesign und visuelle Verfeinerung des Säulenmonitors (`pillar_monitor` / Top-Banner & Chat-Monitor).
   - Saubere Typografie, harmonische Farbverläufe, konsistente Polsterung/Margins, modernere Badges für Live-Zuschauer, Münz-Counter und Stream-Ziele.
   - Fehlerfreie Darstellung bei unterschiedlichen Bildschirmauflösungen und Video-Layouts (9:16 vs. 16:9).

3. **Gefolgte Live-Kanäle in Discovery als eigener Sub-Tab:**
   - In `DiscoveryView.vue` einen neuen Tab **„Gefolgt“ / „Following Live“** ergänzen (neben *Trending* und *Suche*).
   - Liest bei hinterlegtem TikTok-Session-Cookie die aktuell aktiven Live-Streams der Accounts aus, denen das angemeldete Profil folgt (`/webcast/feed/` bzw. Following-Live-Endpoints).
   - Direkte Schnellwahl, Zapper-Support und Übernahme in die Regie-Queue.

4. **TikTok Cookie (Account) umschaltbar machen (Account-Switcher):**
   - Verwaltung mehrerer TikTok-Accounts / Session-Cookies (`sessionid`, `tt-target-idc`, etc.).
   - Schnelles Umschalten zwischen Accounts im Dashboard (z. B. unter Discovery oder in den Einstellungen).
   - Sichere Speicherung (`data/tiktok-accounts.json`, 0600) und Zuordnung von Discovery-Feeds zum jeweils aktiven Account.

---

## Detaillierte Anforderungen

### 1. Webcast-Echtzeit für Chat & Gifts / Einnahmen
- Implementierung eines nativen TikTok-Webcast-Clients (Protobuf/WebSocket bzw. HTTP-Long-Polling auf `webcast.tiktok.com/webcast/im/fetch/`):
  - Dekodierung von `WebcastChatMessage` (Benutzername, Text, Badges) direkt in die Relay-Chat-Engine.
  - Dekodierung von `WebcastGiftMessage` zur Live-Aktualisierung der Einnahmen/Coins ohne TokTracker-Verzögerung.
  - Automatisches Einhängen in den aktuellen Streamer bei Wechsel/Start.

### 2. Polish Säulenmonitor-Overlay
- CSS/Canvas-Refactoring für das Pillar-Monitor-Layout in `src/core/overlays/chat-canvas.ts`:
  - Elegante Glasmorphismus- / Dark-Sci-Fi-Ästhetik passend zum RELAY-Theme.
  - Flexiblere Breitenanpassung und saubere Text-Ellipsis bei langen Usernamen oder Geschenk-Nachrichten.
  - Animationen für Gift-Events (Combo-Zähler, dezente Flash-Effekte).

### 3. Discovery: Tab „Gefolgt“ (Following Live)
- Anbindung des Webcast-Following-Feeds im `DiscoveryService` (`FollowingProvider`):
  - Listet alle Channels auf, denen der eingeloggte Account folgt und die gerade live sind.
  - Anzeige von Profilbildern, Raum-Titeln und aktuellen Zuschauerzahlen.
  - Voll kompatibel mit dem Live-Zapper (`▲` / `▼`).

### 4. TikTok Account-Switcher
- Backend-Store für TikTok-Profile:
  - Maskierte Speicherung der Cookies, Profilname, Avatar und ID.
  - API-Routen: `GET /api/discovery/accounts`, `POST /api/discovery/accounts`, `POST /api/discovery/accounts/:id/activate`, `DELETE /api/discovery/accounts/:id`.
- UI-Komponente:
  - Account-Auswahl-Dropdown in der Discovery-Kopfleiste oder den Einstellungen.
  - Schneller Wechsel ohne Neustart des Servers.

---

## Akzeptanzkriterien

1. Der Säulenmonitor wirkt aufgeräumt, responsiv und visuell poliert.
2. Discovery bietet den Tab „Gefolgt“, der Live-Feeds des aktuell aktiven Accounts anzeigt.
3. Mehrere TikTok-Cookies können hinterlegt und per Klick gewechselt werden.
4. Chat und Geschenke werden bei aktiver Raum-Verbindung direkt über Webcast bezogen.
5. Alle Types, Tests und Lint-Prüfungen (`npm run check`) sind grün.
