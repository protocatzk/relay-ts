## Ziel

Einen interaktiven **TikTok Live Discovery Zapper (Feed-Player)** in `DiscoveryView.vue` integrieren, mit dem entdeckte Live-Streamer direkt im Browser als Live-Video angeschaut und wie bei TikTok Live über vertikale Pfeil-Buttons rechts (`▲` / `▼`) oder Pfeiltasten (`ArrowUp` / `ArrowDown`) nahtlos durchgezappt werden können – inklusive Endlos-Nachladen (Infinite Feed) und direkten Regie-Aktionen (*Umschalten*, *In Queue*, *Speichern*).

## Hintergrund & Technik

- Die TikTok-Webcast-Endpunkte (`/webcast/feed/` und `api-live/user/room`) liefern in jedem Raum-Objekt bereits direkt signierte HTTP-FLV-Stream-URLs (`stream_url.flv_pull_url`, `live_core_sdk_data.pull_data.stream_data`) sowie Raum-Cover (`cover.url_list`) aus.
- Das Dashboard verfügt bereits über `mpegts.js`, das HTTP-FLV-Live-Streams (`type: 'flv'`) nativ über Media Source Extensions (MSE) abspielen kann.
- Um CORS- und Referer-Blockaden des TikTok-CDNs im Browser zu umgehen, ohne CPU-Last durch Re-Encoding zu erzeugen, reicht ein schlanker Zero-Copy-Passthrough-Endpunkt (`GET /api/discovery/preview/:handle`) den HTTP-FLV-Bytestream direkt an `mpegts.js` durch und bricht die Upstream-Verbindung beim Umschalten oder Schließen sofort per `AbortController` ab.

## Umfang

1. **Stream-URL- & Cover-Extraktion (`src/core/source/discovery/`):**
   - `DiscoveryHit` um `cover_url?: string | null` erweitern; `stream_url` (FLV) intern im `DiscoveryService` (In-Memory-Map `streamUrlCache`, nicht öffentlich als rohe CDN-Signatur geleakt oder direkt für den Proxy abrufbar) bzw. über frischen `roomInfo`-Fallback auflösen.
   - Unterstützung für `cursor` / `page`-basiertes Nachladen (`loadMore` / `page` Parameter bei `GET /api/discovery/trending` und `GET /api/discovery/search`), damit beim Durchzappen endlos neue Live-Streamer nachgeladen werden.

2. **Zero-CPU HTTP-FLV Passthrough (`GET /api/discovery/preview/:handle`):**
   - Löst die aktuelle FLV-Pull-URL des Handles auf (aus dem Discovery-Cache oder frisch über `api-live/user/room`).
   - Validiert die Ziel-Domain strikt gegen TikTok-CDN-Hosts (`*.tiktokcdn.com`, `*.tiktokcdn-eu.com`, `*.tiktokv.com`), um SSRF auszuschließen.
   - Piped den HTTP-FLV-Stream (`Content-Type: video/x-flv`) ohne ffmpeg/Transcoding direkt an den Client; schließt den Upstream-Fetch sofort bei `request.raw.on('close')`.

3. **Live-Zapper / Feed-Player in `DiscoveryView.vue`:**
   - Umschalter zwischen **Karten-Grid (`🗂 Grid`)** und **Live-Zapper (`📺 Live-Zapper`)** sowie „👁 Live reinschauen“-Button auf jeder aktiven Streamer-Karte.
   - 9:16 / 16:9 Video-Stage mit `mpegts.js`-FLV-Player, Poster/Cover-Fallback, Mute/Unmute-Toggle, Lautstärkeregler und Lade-/Status-Overlay.
   - **Rechte Pfeil-Steuerung (`▲ Vorheriger` / `▼ Nächster`)** + Tastatur-Support (`ArrowUp` / `ArrowDown`) + Zähler (`3 / 29`).
   - **Infinite Feed:** Automatischer Hintergrund-Fetch der nächsten Seite, sobald der Nutzer sich den letzten 2 Einträgen nähert.
   - **Regie-Quick-Actions im Player-HUD:** `💾 Speichern` / `⚡ Aktivieren`, `⏭ In Queue`, `▶ Jetzt auf YouTube schalten`.

## Akzeptanzkriterien

- [ ] Klick auf einen Live-Streamer oder Wechsel in den `📺 Live-Zapper`-Modus startet die Live-Video-Vorschau im Browser.
- [ ] Rechts neben dem Player ermöglichen Pfeil-Buttons (`▲` / `▼`) sowie die Pfeiltasten (`ArrowUp` / `ArrowDown`) das sofortige Durchzappen zum nächsten/vorherigen Live-Streamer.
- [ ] Am Ende der Liste werden automatisch weitere Live-Streamer nachgeladen.
- [ ] Der FLV-Proxy validiert TikTok-CDN-Hosts gegen SSRF und beendet Upstream-Verbindungen sofort beim Weiterzappen.
- [ ] `npm run check` und `npm run build` sind grün.
