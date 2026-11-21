## Ziel

Laufende und abgeschlossene MKV-Aufzeichnungen (`RecordingController`) mit Highlight-Markern versehen, schnell zu MP4 remuxen/zuschneiden und direkt in `data/media/` für Playlists/Regie-Queue übernehmen.

## Hintergrund

- Seit v0.18/v0.19 zeichnet RELAY den Sink-Output als `.mkv` auf (`src/core/recording/recording-controller.ts`) und erfasst Chat-Aktivität in `ChatAnalytics` (`src/core/overlays/chat-analytics.ts`).
- Bisher lassen sich Aufzeichnungen unter `/api/recordings` nur auflisten, herunterladen oder löschen – für Social-Clips oder Wiederholungen in `data/media/` fehlt ein direkter Workflow.

## Umfang

- **Highlight-Marker:**
  - Zeitstempel-Marker (`data/recordings/<name>.markers.json`) während aktiver Aufnahme setzen – manuell über Dashboard/Stream-Deck/Telegram sowie optional automatisch bei Chat-Spikes (`messages_per_minute >= Schwelle`).
- **Remux & Clip-Export:**
  - Asynchroner Job (`ffmpeg -ss ... -t ... -c copy`) zum verlustfreien Zuschneiden eines Bereichs oder Remuxen einer MKV-Aufzeichnung nach MP4.
  - Aktion „In Medien übernehmen" kopiert/remuxt das Ergebnis direkt nach `data/media/` inklusive `ffprobe`-Metadaten und Thumbnail.
- **UI:**
  - Erweiterung der Aufnahmen-Liste in `OutputView.vue` / `MediaView.vue` um Marker-Liste, Clip-Dialog (Start/Ende) und „Zu Medien"-Button.

## Akzeptanzkriterien

- [ ] Marker lassen sich während der Aufnahme setzen und werden zusammen mit der Aufnahme verwaltet/gelöscht.
- [ ] Clip-Export/Remux läuft ohne Blockierung des Event-Loops und validiert Dateinamen strikt gegen Path Traversal.
- [ ] Übernommene Clips sind sofort in `MediaView.vue` und der Regie-Queue nutzbar.
- [ ] `npm run check` und `npm run openapi:check` grün.
