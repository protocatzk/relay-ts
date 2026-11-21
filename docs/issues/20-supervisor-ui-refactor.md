## Ziel

Wartbarkeit der größten Kern- und Frontend-Dateien wiederherstellen, indem gewachsene Verantwortlichkeiten aus `supervisor.ts`, `SettingsView.vue` und `OverlaysView.vue` in klar abgegrenzte Module herausgelöst werden.

## Hintergrund

- Seit dem v0.6.1-Refactoring sind neue Features (Regie-Queue mit Seek/Resume, Multi-Destination-Sink, MKV-Recording, Auto-Refresh, weitere Overlays) hinzugekommen.
- Dadurch ist `src/core/supervisor/supervisor.ts` wieder auf ~2.250 Zeilen gewachsen; `SettingsView.vue` (~1.255 Zeilen) und `OverlaysView.vue` (~1.289 Zeilen) sind ebenfalls sehr groß geworden.

## Umfang

- **Backend (`src/core/supervisor/`):**
  - `MediaPlaybackController` (lokale `file:`-Wiedergabe, Seek-Offset, Resume-Persistenz) aus `supervisor.ts` extrahieren.
  - `AutoSwitchController` (`preferred`-Streamer-Erkennung, Prioritäten, Wiederherstellung des vorherigen Ziels) kapseln.
  - Recording-/Secondary-Sink-Lifecycle sauber über ein gemeinsames `OutputFanout`-Interface bündeln.
- **Frontend (`src/web/src/views/`):**
  - `SettingsView.vue` in eigenständige Sektions-Komponenten aufteilen (Video/Encoder, Pause/Startup, Einnahmen, YouTube, Telegram, Sicherheit).
  - `OverlaysView.vue` pro Overlay-Typ (Chat, Logo, Uhr, Text, Einnahmen, Ziel, Version) in Unterkomponenten zerlegen.

## Akzeptanzkriterien

- [ ] Keine funktionalen Regressionen: alle bestehenden Unit-, Integrations- und E2E-Tests bleiben ohne Anpassung der Assertions grün.
- [ ] `supervisor.ts` sinkt deutlich unter 1.200 Zeilen; neue Controller haben fokussierte Unit-Tests.
- [ ] `npm run check`, `npm run build` und `npm run test:e2e` grün.
