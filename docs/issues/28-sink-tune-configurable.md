## Ziel

Den fest verdrahteten `zerolatency`-Tune beim Sink-Encoder konfigurierbar machen und dokumentiert messen, ob er für den Restream-Fall überhaupt sinnvoll ist.

## Hintergrund

- `buildSinkCommand()` hängt aktuell immer `tune=zerolatency` an (`src/core/source/ffmpeg.ts:328`). Der Tune deaktiviert B-Frames und Lookahead und kostet nachweislich Kompressionseffizienz (Größenordnung 10–20 % mehr Bitrate für dieselbe Qualität).
- RELAY hält den Stream über den DelayBuffer ohnehin auf Latenz – im Gegensatz zu interaktiven Live-Setups ist minimale End-to-End-Latenz hier kein Ziel. Der Hauptgrund für `zerolatency` (Reaktionszeit beim Encoder) greift damit weitgehend ins Leere.
- Gegenargument, das geprüft werden muss: Nach Reconnects könnte YouTube durch schnellere Verfügbarkeit der ersten Frames schneller zurückkehren. Das ist zu messen, bevor der Default geändert wird.
- `preset` ist bereits konfigurierbar (`settings.video.preset`, Default `veryfast`); `tune` ist der fehlende Hebel.

## Umfang

- **Konfiguration (`src/core/config/schema.ts`):**
  - Neues Feld `settings.video.tune` (z. B. `off | zerolatency`, Default `zerolatency` zur Rückwärtskompatibilität).
- **ffmpeg-Kommando (`src/core/source/ffmpeg.ts`):**
  - Tune aus der Konfiguration übernehmen; für Pause-/Media-Wiedergabe-Bildschirme bleibt das bestehende Verhalten bestehen (dort ist die Latenz ohnehin irrelevant).
- **Doku:**
  - `README.md` und `AGENTS.md` (Laufzeit-Invarianten) um das neue Feld ergänzen, inkl. Empfehlung, wann `off` sinnvoll ist.
- **Messung:**
  - Vergleichsmessung dokumentieren (Bitrate bei konstanter Qualität bzw. CPU-Last bei konstanter Bitrate, mit und ohne `zerolatency`) und das Ergebnis in der Doku festhalten.

## Akzeptanzkriterien

- [ ] `settings.video.tune` ist konfigurierbar; ohne Konfiguration verhält sich RELAY exakt wie heute.
- [ ] Der Tune greift (wie `preset`) auch auf Hardware-Encoder-Skalen oder wird dort sauber ignoriert/dokumentiert.
- [ ] Mess-Ergebnis (Bitrate/CPU mit vs. ohne `zerolatency`) ist dokumentiert; ggf. Empfehlung im README aktualisiert.
- [ ] `npm run check` grün.
