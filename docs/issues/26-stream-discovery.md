## Ziel

Ein Discovery-Modul integrieren, mit dem neue TikTok-Live-Streamer anhand von Suchbegriffen, Hashtags oder Empfehlungen durchsucht, mit Live-Status und Metadaten visualisiert und mit einem Klick in die Streamer-Liste oder Regie-Queue übernommen werden können.

## Hintergrund

- Aktuell müssen neue Streamer manuell mit TikTok-Handle und Stream-Key in der Streamer-Konfiguration angelegt werden.
- Betreiber möchten interessante oder aktuell live gehende Streamer direkt aus der App entdecken, prüfen wer gerade sendet (Titel, Thumbnail, Zuschauer) und sofort auf diesen Stream umschalten oder ihn für die spätere Wiedergabe vormerken.

## Umfang

- **Discovery-Service (`src/core/source/discovery-service.ts`, `src/api/routes/discovery.ts`):**
  - Provider zur Suche von Live-Streams (z. B. via TikTok Live Search / Web-API-Scraping über `yt-dlp` oder dedizierten Discovery-Scraper).
  - Endpunkte:
    - `GET /api/discovery/search?q=...`: Suche nach Begriffen/Hashtags.
    - `GET /api/discovery/trending`: Aktuell populäre deutschsprachige / relevante Live-Streams.
  - Rückgabe-Objekt: Streamer-ID, Display-Name, Avatar-URL, Bio, aktueller Raum-Titel, Live-Status, Zuschauerzahl.
  - Aktionen:
    - `POST /api/discovery/add`: Streamer direkt mit Default-Werten in `streamers.yml` übernehmen.
    - `POST /api/discovery/queue`: Streamer sofort als nächstes Ziel in die Regie-Queue einfügen (`POST /api/queue/now`).
- **Frontend-Integration (`src/web/src/views/StreamersView.vue` oder eigener Tab):**
  - Discovery-Suchleiste mit Filter nach Live-Status.
  - Streamer-Karten mit Live-Vorschau, Viewer-Count und Quick-Buttons ("Jetzt umschalten", "In Queue", "Als Streamer speichern").
  - Barrierefreie Tastatur- und Screenreader-Bedienung.

## Akzeptanzkriterien

- [ ] Suchanfragen liefern strukturierte Ergebnisse mit Live-Status und Profil-Informationen.
- [ ] Streamer können mit einem Klick zur permanenten Liste oder zur Regie-Queue hinzugefügt werden.
- [ ] Rate-Limits und Offline-Zustände werden transparent dargestellt.
- [ ] Barrierefreie UI im TokTracker-Design.
- [ ] `npm run check` grün.
