## Ziel

Einheitliche Audio-Lautstärke zwischen wechselnden TikTok-Live-Quellen, Pausenscreens und lokalen Playlist-Videos (`file:`) sowie automatische Erkennung von Audio-Stille.

## Hintergrund

- Live-TikTok-Streams und lokale MP4/MKV-Dateien in `data/media/` unterscheiden sich oft stark in der Lautstärke, was beim Umschalten zu unangenehmen Sprüngen oder Übersteuerung auf YouTube führt.
- Aktuell prüft der Watchdog nur Datenrate/Video-Frames, aber nicht, ob eine Quelle komplett stumm ist.

## Umfang

- **Lautheits-Normalisierung & Gain:**
  - Neue `audio`-Optionen in `settings.yml` (z. B. `normalize`: `off` | `loudnorm` | `dynaudnorm`, `target_lufs`: Default `-16`, `gain_db`: `-24`..`+24`).
  - Optional pro lokalem Medien-Eintrag (`media-metadata`) oder global im Sink anwendbar (ffmpeg `-af`).
  - Live-Änderung analog zu Video-Layout mit kontrolliertem Sink-Neustart.
- **Stille-Erkennung (optional / Warnung):**
  - Konfigurierbare `silencedetect`-Überwachung oder Peak-Messung für Health/Diagnostics und Telegram-Warnung (ohne automatischen Restart-Loop).

## Akzeptanzkriterien

- [ ] Audio-Normalisierung und Gain sind über Settings-UI und `PUT /api/settings` konfigurierbar.
- [ ] ffmpeg-Filterkette wird sauber gebaut und in `tests/ffmpeg.test.ts` (bzw. Sink-Tests) geprüft.
- [ ] Bei `normalize: off` und `gain_db: 0` bleibt das Audio-Verhalten unverändert.
- [ ] `npm run check` grün; neue Schema-Felder in OpenAPI und Frontend-Typen ergänzt.
