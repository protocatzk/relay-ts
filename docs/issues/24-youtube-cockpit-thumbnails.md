## Ziel

Im YouTube-Cockpit (`YouTubeView.vue` / Broadcast-Verwaltung) das direkte Hochladen und Zuweisen von individuellen Video-Thumbnails für geplante und aktive YouTube-Livestreams ermöglichen.

## Hintergrund

- Bislang können YouTube-Broadcasts in RELAY angelegt, editiert und überwacht werden, aber Vorschaubilder (Thumbnails) mussten umständlich im externen YouTube Studio hochgeladen werden.
- Die YouTube Data API v3 stellt hierfür die Methode `thumbnails.set(videoId)` bereit.
- Für die mobile Regie und einen reibungslosen Workflow soll das Thumbnail direkt im RELAY-Cockpit ausgewählt, in der Vorschau geprüft und zugewiesen werden können.

## Umfang

- **Backend (`src/core/youtube/youtube-client.ts`, `src/api/routes/youtube.ts`):**
  - Neue Methode im YouTube-Client: `setBroadcastThumbnail(broadcastId: string, imageBuffer: Buffer, mimeType: string)`.
  - API-Endpunkt `POST /api/youtube/broadcasts/:id/thumbnail` mit Multipart-Upload.
  - Strikte Validierung: Bildformate JPEG/PNG, max. 2 MB, Magic-Byte-Prüfung, Warnung bei ungünstigem Seitenverhältnis (empfohlen 16:9 bzw. 1280x720).
- **Frontend (`src/web/src/views/YouTubeView.vue`):**
  - Thumbnail-Vorschau und Upload-Trigger direkt in der Broadcast-Detailansicht / -Karte.
  - Drag-and-Drop sowie Datei-Auswahldialog mit Dateigrößenprüfung vor dem Upload.
  - Barrierefreie Bedienung (Keyboard-Support, ARIA-Labels, Screenreader-Rückmeldung).
- **Dokumentation & Tests:**
  - OpenAPI-Spezifikation aktualisieren.
  - Unit-Tests für `setBroadcastThumbnail` mit gemockter YouTube-API.

## Akzeptanzkriterien

- [ ] Upload von JPEG/PNG bis 2 MB weist dem gewählten Broadcast über die YouTube Data API das Thumbnail zu.
- [ ] Ungültige Dateien (falscher Typ, > 2 MB) werden mit klaren Fehlermeldungen abgewiesen.
- [ ] Erfolgreiche Zuweisung aktualisiert die Vorschau im Cockpit sofort.
- [ ] Mobile- und Desktop-Layouts sind responsiv und barrierefrei bedienbar.
- [ ] `npm run check` grün.
