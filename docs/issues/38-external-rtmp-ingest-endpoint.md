# Issue 38: Externen RTMP-Ingest-Endpoint für Gaming-Streams einbauen (mit konfigurierbarem Stream-Key)

## Übersicht

RELAY holt Videostreams aktuell primär als Client ab:
1. TikTok Live via Quell-FFmpeg / Webcast
2. Lokale MP4/WebM-Dateien aus `data/media/`
3. Generierte Pause-/Startbildschirme

Für **Gaming-Streams** (z. B. OBS Studio, Streamlabs, vMix oder Hardware-Encoder von PS5/Xbox/PC) fehlt die Möglichkeit, dass ein externer Streamer oder Regisseur direkt per **RTMP-Push** in RELAY einspeisen kann. 

RELAY soll als lokaler / extern erreichbarer **RTMP-Server (Ingest-Server)** fungieren. Trifft ein valider Stream ein, kann dieser als eigenständige Quelle in RELAY übernommen und wie jeder andere Streamer verarbeitet werden (inkl. DelayBuffer, Overlays, YouTube-Sink, Recordings und Audio-Processing).

---

## Anforderungen & Kernfunktionen

### 1. RTMP Ingest Server (Port 1935 / konfigurierbar)
- Bereitstellung eines schlanken internen RTMP-Servers (z. B. via Node-Media-Server, FFmpeg RTMP-Listener oder integrierter RTMP-Bridge).
- Konfigurierbarer Ingest-Port (Standard: `1935` oder per Env `RTMP_INGEST_PORT`).
- Unterstützte Stream-Pfade: `rtmp://<host>:<port>/live/<stream-key>`.

### 2. Konfigurierbare Stream-Keys & Authentifizierung
- Schutz des Ingests: Eingehende RTMP-Verbindungen müssen gegen einen konfigurierten Stream-Key geprüft werden (z. B. in `settings.yml` unter `streaming.rtmp_ingest_key` oder per Streamer-Eintrag).
- Ungültige oder unautorisierte Keys werden sofort mit TCP/RTMP-Reset abgewiesen (`onPublish`-Hook).
- Optional: Mehrere Keys / Streamer-spezifische Keys (z. B. Streamer-Eintrag vom Typ `rtmp:`).

### 3. Nahtlose Integration in die RELAY State-Machine & Supervisor
- **Quellen-Typ `rtmp`:** Ein Streamer oder Regie-Eintrag kann als RTMP-Quelle definiert werden (z. B. `tiktok: "rtmp://..."` oder `source_type: "rtmp"`).
- **Auto-Takeover / Vorrang:** Sobald der Gaming-Stream auf dem RTMP-Endpoint aktiv Daten sendet, kann RELAY (konfigurierbar) automatisch die Regie übernehmen (ähnlich wie `preferred`-Streamer) und den YouTube-Sink auf das Gaming-Signal umblenden.
- **Graceful Fallback:** Trennt der Gaming-Streamer die OBS-Verbindung (oder stallt die Verbindung), greift sofort der konfigurierte Fallback (Pausenscreen, Regie-Queue oder Backup-TikTok-Streamer), ohne dass der YouTube-Sink abreißt.

### 4. Transcoding & Passthrough-Optionen
- Gaming-Streams kommen meist bereits in sauberem H.264/AAC mit festem CFR und 60 FPS an.
- Option zur direkten Übernahme (`-c copy`) oder Anpassung/Re-Encoding an die RELAY-Zielauflösung (`video.resolution`, z. B. 1280x720 oder 1920x1080) und Ziel-Framerate.
- Audio-Processing (Loudnorm / Gain) und Overlays (Logo, Chat, Alerts) bleiben voll funktionsfähig.

### 5. Dashboard-UI & Verbindungs-Status
- **Einstellungs-Karte:** RTMP-Server aktivieren/deaktivieren, Port, Ingest-URL zum einfachen Kopieren (`rtmp://...`) und Stream-Key generieren/einsehen.
- **Live-Status:** Anzeige im Dashboard / Cockpit, ob aktuell ein externer RTMP-Client verbunden ist (FPS, Auflösung, Bitrate, Dropped Frames).
- **Streamer-Verwaltung:** Option, einen Kanal als "Externer RTMP-Stream" anzulegen.

---

## Akzeptanzkriterien

1. Ein OBS-Client kann zu `rtmp://<relay-host>:1935/live/<key>` streamen.
2. Ungültige Keys werden verworfen; valide Keys starten die Video-Pipeline in RELAY.
3. Das Bild wird unterbrechungsfrei an YouTube gestreamt; Overlays & DelayBuffer greifen regulär.
4. Nach dem Beenden von OBS schaltet RELAY automatisch auf Pause/Fallback um, ohne dass der YouTube-Stream beendet wird.
