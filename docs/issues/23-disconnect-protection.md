## Ziel

Verbindungsabbrüche oder Quellausfälle (TikTok-Stall, Netzwerkunterbrechung) durch eine zuverlässige Disconnect Protection absichern. Bei Verbindungsverlust wird nahtlos ein Endlosbild/Slate oder ein Loop-Video auf Relay-Ebene eingespielt, während der YouTube-Sink und aktive Aufnahmen ohne RTMP-Neustart oder Artefakte unterbrechungsfrei weiterlaufen.

## Hintergrund

- Bricht die TikTok-Quelle unvorhergesehen ab oder gerät in einen Daten-Stall, droht der YouTube-Sink abzureißen oder YouTube meldet Verbindungsabbruch ("Keine Daten empfangen"), was Streams beendet oder Zuschauer verliert.
- Professionelle Broadcasting-Tools (z. B. Twitch Disconnect Protection) fangen Verbindungsverluste ab, indem sofort ein Standbild oder Füll-Loop gesendet wird, bis der Ingest wieder aktiv ist.
- RELAY besitzt bereits den `PauseScreen`, aber:
  - Bei Netzwerk-Stalls (Zombie-Verbindung) kann der Stream bis zum Watchdog-Timeout hängen, bevor ein Pausen-Slate greift.
  - Bei aktiver Aufnahme (`recording`) und Secondary-Sink müssen Disconnects atomar überbrückt werden, ohne dass die MP4/MKV-Datei beschädigt wird.
  - Das Endlosbild/Slate muss exakte, kontinuierliche CFR-Timestamps liefern, bis der Streamer wieder live ist oder ein konfigurierter Maximal-Timeout erreicht wird.

## Umfang

- **Früherkennung & Umschaltung (`src/core/source/`, `src/core/supervisor/source-recovery.ts`):**
  - Schnelle Stall- und Disconnect-Erkennung bei Daten-Stillsand (z. B. keine MPEG-TS-Pakete für > 3 s trotz laufendem Prozess).
  - Nahtlose Aktivierung des Endlosbildes/Pausenscreens auf Relay-Ebene ohne Unterbrechung der Sink-Pipes.
  - Konfigurierbares Disconnect-Asset (`settings.pause.disconnect_asset` oder Fallback auf Standard-Pausenbild).
  - Maximale Schutzdauer (`pause.disconnect_max_minutes`, z. B. Default 5 Minuten); nach Ablauf kontrollierter Stop oder Weiterleitung.
- **Sink- & Recording-Integrität:**
  - Garantierte CFR-Generierung und Audio-Füllung (Stille / sanftes Rauschen) im Sink, um YouTube-RTMP-Ingest stabil zu halten.
  - Laufende Aufnahmen werden ohne Timestampsprünge fortgeführt.
- **Observability & UI:**
  - Statusanzeige "Disconnect Protection aktiv" in SSE-Events, Header und Live-Menü.
  - Neuer Zähler `disconnect_protection_events_total` in den Prometheus-Metriken.

## Akzeptanzkriterien

- [ ] Plötzliche Quellabbrüche oder Stalls aktivieren sofort die Disconnect Protection mit Endlosbild/Slate.
- [ ] Der YouTube-Sink und laufende Aufnahmen laufen während der Schutzphase unterbrechungsfrei weiter.
- [ ] Gelingt der Reconnect zur Quelle, schaltet RELAY nahtlos vom Endlosbild zurück auf das Live-Video.
- [ ] Nach Überschreitung der maximalen Schutzdauer wird der Stream geordnet beendet.
- [ ] Status und Ereignisse werden im Dashboard und in `/health` ausgewiesen.
- [ ] `npm run check` grün; Unit- und Integrationstests decken Disconnect-Szenarien ab.
