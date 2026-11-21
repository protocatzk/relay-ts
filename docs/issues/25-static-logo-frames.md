## Ziel

Das Logo-Overlay soll sein statisches, einmal vorgerendertes RGBA-Frame nur einmal (oder wenige Frames lang) in die ffmpeg-Pipe schreiben, statt es im Sekundentakt endlos zu wiederholen.

## Hintergrund

- `LogoOverlayEngine` rendert das Logo einmal vor (`src/core/overlays/logo-engine.ts`) und schreibt im Tick (~`fps * 1.05`, Standard ~10,5/s) dasselbe unveränderliche Frame in die rawvideo-Pipe.
- Das Overlay wird im Sink-Filtergraph mit `overlay=...:format=auto:eof_action=repeat:repeatlast=1` eingeblendet (`src/core/source/ffmpeg.ts`). `repeatlast` bedeutet: nach Stream-Ende wird das letzte Frame dauerhaft wiederholt – das Logo bleibt also auch nach einmaligem Senden sichtbar.
- Damit läuft heute dauerhaft eine Pipe-Schreiblast (Breite × Höhe × 4 Bytes × fps) inkl. Syscalls und Timer-Awakes, obwohl sich das Frame nie ändert.

## Umfang

- **LogoOverlayEngine (`src/core/overlays/logo-engine.ts`):**
  - Nach dem Schreiben des (optional kurz wiederholten) Frames die Ausgabe sauber beenden (`stream.end()`), statt den Tick-Timer weiterlaufen zu lassen.
  - Beachten: Der bestehende `detach()`-Aufruf macht bereits `stream.end()` – die Logik muss mit der Engine-Adoption harmonieren (siehe Kommentar in `OverlayRuntime.adoptEngine`: ein Detach auf wiederverwendeten Pipes würde `fd 3`/`fd 4` dauerhaft schließen). Ein explizites `static done`-Flag statt Endlos-Ticking wäre sauber.
  - Neustart-/Re-Attach-Pfad prüfen: nach einem Sink-Restart muss ein frisches Logo-Frame erneut gesendet werden, bevor die Pipe endet.
- **Optionen & Tests:**
  - Verhalten konfigurierbar halten oder per Konstante dokumentieren (fallback: Endlos-Tick), falls `eof_action=repeat` in älteren ffmpeg-Versionen abweichend reagiert.
  - Unit-Test: nach `attach()` werden genau N Frames geschrieben, danach endet der Stream; Overlay-Filtergraph bleibt unverändert.

## Akzeptanzkriterien

- [ ] Kein dauerhafter Frame-Tick mehr beim Logo-Overlay; die Pipe endt nach dem statischen Senden.
- [ ] Das Logo bleibt im laufenden Stream sichtbar (kein Verschwinden nach kurzer Zeit).
- [ ] Sink-Restart und Engine-Re-Adoption funktionieren unverändert.
- [ ] `npm run check` grün.
