## Ziel

Benannte Overlay-Szenen (Profile aus `overlays` + `video.layout`) serverseitig speichern und im Live-Betrieb mit einem Klick wechseln können – statt nur manuelle JSON-Exports im Overlay-Studio zu pflegen.

## Hintergrund

- Aktuell existiert genau eine globale Overlay-Konfiguration in `settings.yml`, ergänzt um clientseitigen JSON-Export/-Import im Overlay-Studio (`OverlaysView.vue`).
- Im Regie-Alltag wechseln Anforderungen häufig (z. B. „Standard 9:16", „Vollbild-Zoom", „Einnahmen-Fokus", „Minimal ohne Chat").
- `OverlayRuntime` und `SinkController` unterstützen bereits saubere Live-Neustarts bei Overlay-/Layout-Änderungen.

## Umfang

- **Backend & Persistenz:**
  - Szenen-Store (`data/scenes.json` oder eigener Abschnitt in `config/settings.yml`, atomar `0600`) mit `id`, `name`, `overlays`-Snapshot und optional `video_layout`.
  - API-Routen: `GET /api/scenes`, `POST /api/scenes` (aus aktuellem Zustand oder Payload), `PUT /api/scenes/:id`, `DELETE /api/scenes/:id`, `POST /api/scenes/:id/activate`.
  - SSE-Event `scene_changed` / aktiven Szenen-Namen in `GET /api/status` ausgeben; Audit-Log-Eintrag bei Aktivierung.
- **Frontend & Steuerung:**
  - Szenen-Umschalter im Overlay-Studio, im `LiveMenu.vue` und als konfigurierbare Aktion im `StreamDeckView.vue`.
  - Optional Telegram-Befehl `/scene <name>` bzw. Inline-Auswahl.

## Akzeptanzkriterien

- [ ] Szenen lassen sich anlegen, umbenennen, überschreiben, löschen und live aktivieren.
- [ ] Aktivierung wendet Overlays + Video-Layout atomar an und startet bei aktivem Stream nur einmal kontrolliert den Sink neu.
- [ ] Integration in Stream-Deck und Live-Menü vorhanden.
- [ ] Neue Routen in `src/api/openapi.ts` + `docs/openapi.json` dokumentiert; `npm run check` grün.
