## Ziel

Zeitgesteuerte Automatisierung für Stream-Starts, -Stopps und Quellenwechsel (Streamer, Playlist, Regie-Queue oder manuelle Screens) nach festen Uhrzeiten und Wochentagen.

## Hintergrund

- Bisher startet RELAY nur manuell, per `preferred`-Online-Erkennung oder per Auto-Start beim Serverstart.
- Für wiederkehrende Sendefenster (z. B. „Täglich 20:00 Startbildschirm → Playlist A, 02:00 Stopp") fehlt ein eingebauter Zeitplan ohne externe Cronjobs.

## Umfang

- **Backend:**
  - Persistenter Scheduler-Store (`data/schedules.json`, `0600`) mit Regeln: `id`, `name`, `enabled`, `days` (0–6), `time` (`HH:MM`), `timezone`, `action` (`start_streamer` | `start_playlist` | `start_queue` | `start_screen` | `stop`), `target_id`.
  - Scheduler-Runner im Supervisor-Kontext mit Minuten-Raster (kein Doppel-Trigger innerhalb derselben Minute) und sauberem Logging/Audit-Log.
  - Klare Vorrangregeln gegenüber `preferred`-Auto-Start dokumentieren.
- **API & UI:**
  - CRUD-Routen unter `/api/schedules` inkl. Toggle (`enabled`) und „Jetzt testen/ausführen".
  - Verwaltungsansicht im Dashboard (z. B. unter `Inhalte` oder `System`) mit Nächste-Ausführung-Anzeige.

## Akzeptanzkriterien

- [ ] Zeitpläne überleben Server-Neustarts und triggern genau einmal pro geplantem Zeitpunkt.
- [ ] Deaktivierte Regeln und ungültige Ziele werden sauber abgefangen und geloggt.
- [ ] Unit-Tests für Zeitberechnung, Zeitzonen/DST und Doppel-Trigger-Schutz.
- [ ] `npm run check` und `npm run openapi:check` grün.
