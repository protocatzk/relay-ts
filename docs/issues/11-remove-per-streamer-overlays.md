## Ziel

Die alte Per-Streamer-Overlay-Konfiguration sauber entfernen, nachdem sie global
geworden ist.

## Ausgangslage

`settings.overlays` ist global und wird angewendet. Per-Streamer-Overlays bleiben
nur aus Kompatibilitätsgründen im Schema/Store und werden ignoriert.

## Umfang

- Migrationspfad dokumentieren und beim Start idempotent ausführen.
- Overlay-Felder aus Streamer-Schema, Store-Views und Frontend-Typen entfernen,
  sobald keine Altkonfiguration mehr nötig ist.
- `StreamerEditor` endgültig frei von Overlay-Resten halten.
- Tests für Migration und Entfernen alter Felder.
- Klare Warnung für noch vorhandene Per-Streamer-Overlays.

## Akzeptanzkriterien

- [ ] Bestehende YAMLs werden ohne Datenverlust migriert.
- [ ] Neue/aktualisierte Streamer enthalten keine Overlay-Duplikate mehr.
- [ ] API- und Frontend-Typen sind bereinigt.
- [ ] Doku beschreibt die Migration.
