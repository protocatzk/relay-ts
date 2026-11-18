## Ziel

Pausen-Hintergründe und Fonts komfortabel hochladen, prüfen und vorab ansehen.

## Ausgangslage

`pause.background` und `pause.font` sind Pfad-/URL-Felder. Dateien müssen manuell
nach `data/pause/` kopiert werden. Es gibt keine Vorschau vor dem Speichern.

## Umfang

- Upload-Endpunkt für Hintergrund/Font (Größenlimit, MIME-/Magic-Byte-Prüfung).
- Ablage in `data/pause/` mit sicheren Dateinamen.
- Metadaten: Typ, Auflösung, Dauer, Loop-Fähigkeit.
- Vorschau-Endpunkt für ein PNG oder kurzes Testvideo.
- UI: Dateiauswahl, Fortschritt, Vorschau, Entfernen.
- Statisches SVG weiterhin rastern; animiertes SVG klar als „statisch“ markieren
  oder optional zu WebM konvertieren.

## Akzeptanzkriterien

- [ ] Upload akzeptiert nur erlaubte Bild-/Video-/Font-Formate.
- [ ] Zu große oder manipulierte Dateien werden abgelehnt.
- [ ] Vorschau zeigt das Pause-Design vor dem Speichern.
- [ ] Pfad-/URL-Eingabe bleibt für bestehende Setups erhalten.
- [ ] Tests decken Validierung und Fallback auf Hintergrundfarbe ab.
