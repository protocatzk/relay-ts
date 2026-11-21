## Ziel

In der System- und Diagnose-Übersicht (`DiagnosticsView.vue`) automatisch die System-Ressourcen (CPU, RAM, Disks, Hardware-Encoder) des Servers analysieren und dem Betreiber konkrete, regelbasierte Optimierungsempfehlungen anzeigen.

## Hintergrund

- RELAY führt anspruchsvolle Aufgaben aus: MPEG-TS-Relaying, Video-Re-Encoding, Overlays und Pufferung.
- Fehlkonfigurationen (z. B. `libx264` statt vorhandener GPU-Hardware wie NVENC oder Intel QSV, unzureichender RAM für große Puffer oder knapp werdender Festplattenplatz bei aktiver Aufnahme) führen oft zu unnötigen Rucklern oder Systemausfällen.
- Eine integrierte Hardwarespezifikations- und Empfehlungsansicht hilft Betreibern sofort bei der richtigen Einstellung und beim Server-Sizing.

## Umfang

- **Backend-Erfassung (`src/core/diagnostics.ts`, `src/api/routes/system.ts`):**
  - Abfrage grundlegender Specs: CPU-Modell, Kernanzahl, Gesamtspeicher, freier RAM, Swap, Festplattenauslastung (`statfs`) und gefundene FFmpeg-Encoder (`probeVideoEncoders`).
  - Regelbasierte Empfehlungs-Engine:
    - *Hardware-Encoder:* "NVENC / QSV Hardware-Encoder erkannt, aber Video-Encoder steht auf libx264."
    - *Arbeitsspeicher:* "Freier RAM < 1 GB. Es wird empfohlen, den Delay-Puffer oder die Chat-Historie zu begrenzen."
    - *Speicherplatz:* "Speicher auf /srv/relay unter 15 % frei. Alte Recordings löschen oder Log-Rotation anpassen."
    - *CPU-Last:* "CPU-Dauerlast über 85 %. Ggf. Preset von 'slow' auf 'veryfast' anpassen."
  - Bereitstellung über `GET /api/system/specs` bzw. Erweiterung von `GET /api/system/diagnostics`.
- **Frontend (`src/web/src/views/DiagnosticsView.vue`):**
  - Neue Karte "System-Hardware & Empfehlungen" im TokTracker-Stil mit Status-Badges (Optimal, Empfehlung, Warnung).
  - Direkte Absprung-Links zu den betroffenen Einstellungsbereichen (z. B. direkt zum Video-Encoder-Tab).

## Akzeptanzkriterien

- [ ] System-Spezifikationen (CPU, RAM, Disk, Encoder) werden fehlerisoliert und performant erhoben.
- [ ] Sinnvolle Empfehlungen werden bei Fehlanpassungen oder knappen Ressourcen eingeblendet.
- [ ] Keine Blockierung der Event-Loop (vollständig asynchrone Abfragen).
- [ ] `npm run check` grün; neue Unit-Tests für die Empfehlungs-Engine.
