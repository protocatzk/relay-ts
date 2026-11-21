## Ziel

Dashboard-Timer (Stream-Preview, Media-Liste, Chat-Analytics) pausieren, solange der Tab nicht sichtbar ist, und den Server-Preview-Render mit Cache-Headern entschärfen.

## Hintergrund

- `DashboardView.vue` refreshed alle 5 s die Studio-Preview (`api.overlays.previewUrl` mit `t=${Date.now()}`-Cache-Buster, `src/web/src/api/client.ts`) und die Chat-Analytics; `PlaylistsView.vue` pollt die Media-Dateien ebenfalls alle 5 s.
- Beide Timer laufen auch bei minimiertem oder hintergrund.nodeType-Tab weiter und erzeugen serverseitig jedes Mal ein vollständiges Preview-PNG (Canvas-Render) inklusive Bildtransfer.
- Auf Mobilgeräten (PWA) kostet das unnötig Bandbreite und Akku; serverseitig skaliert die Last linear mit der Anzahl offener Dashboards.
- Der SSE-Status-Kanal (`/api/events`) liefert bereits Änderungsereignisse – die Preview muss nicht blind im Sekundentakt gerendert werden.

## Umfang

- **Dashboard (`src/web/src/views/`):**
  - `visibilitychange`-Listener: Timer bei `document.hidden` pausieren, bei Rückkehr sofort einmal ausführen und fortsetzen.
  - Betroffen: `DashboardView.vue` (Preview + Chat-Analytics), `PlaylistsView.vue` (Media-Liste); prüfen, ob `DiagnosticsView.vue` und `LoginView.vue` davon ebenfalls profitieren.
- **Preview-Routen:**
  - Für Preview-PNGs `ETag`/`Last-Modified` (z. B. Hash aus Overlay-Signatur + Chat-Stand) ausliefern, damit Endpunkte mit `Cache-Control` arbeiten können, statt den Cache per Timestamp zu busten.
  - Optional: kurzer Server-seitiger Preview-Cache (1–2 s TTL) pro Overlay-Signatur, damit mehrere offene Dashboards sich einen Render teilen.

## Akzeptanzkriterien

- [ ] Bei verstecktem Tab werden keine Preview-/Polling-Requests mehr gesendet.
- [ ] Nach Rückkehr in den Tab erscheint sofort ein aktiver Stand (erster Abruf ohne Wartezeit).
- [ ] Preview-Endpunkte honorieren `ETag`/`If-None-Match` bzw. liefern `304`-Antworten.
- [ ] `npm run check` und `npm run test:e2e` grün.
