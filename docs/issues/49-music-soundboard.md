# Musik-Soundboard parallel zum Stream

## Ziel

Ein Soundboard, das Musik und kurze Sounds **zusätzlich zum laufenden Stream**
in den YouTube-Mix spielt — ohne die Quelle zu wechseln, ohne den Sink neu
aufzubauen und ohne Lücke im Stream. Bedienbar über Dashboard, Stream Deck,
Telegram und MCP.

## Ausgangslage (geprüft an 0.36.0)

- Der YouTube-Sink liest Video **und** Audio ausschließlich aus dem Relay
  (`[0:a]`), also aus der aktuellen Quelle (TikTok, lokales Video oder
  Pause-/Startbildschirm). `buildSinkCommand` mappt `0:a:0?` und hängt die
  Audio-Kette über `-af`/`buildAudioFilter` an.
- Der Sink öffnet bereits zwei feste rawvideo-Pipes (fd 3 Chat, fd 4 Logo);
  fd 5 ist frei und wäre der natürliche Träger für ein PCM-Audioprohr.
- Es gibt lokale Medien (`data/media/`) für die Regie-Queue, aber **keine**
  Sound-Assets, keine Mischung mehrerer Audioquellen und keine Möglichkeit,
  während eines Streams etwas einzuspielen.
- Der Sink überlebt Quellenwechsel; jede Änderung an Audio-Einstellungen
  startet ihn dagegen neu. Ein Soundboard darf keinen Neustart auslösen.

## Umfang

### Audio-Pipeline (Kern)

- Neuer `SoundboardEngine` (Node) mischt Sounds/Musik zu **48 kHz, Stereo,
  s16le** und schreibt durchgehend PCM in eine dritte Pipe (fd 5). Ohne aktive
  Sounds schreibt er Stille, damit der Graph stabil bleibt.
- `buildSinkCommand` bekommt einen optionalen `audioInput`:
  - Input: `-f s16le -ar 48000 -ac 2 -i pipe:5` mit eigenem
    `-thread_queue_size`.
  - Audio-Graph im `filter_complex`, sobald das Board aktiv ist:
    `[0:a]aresample … [orig]`, `[5:a]volume=master … [board]`,
    `[orig][board]amix=inputs=2:normalize=0:duration=first[aout]`.
  - Optionales Ducking (Standard an, abschaltbar): `[board]asplit[key][mix]`,
    `[orig][key]sidechaincompress=threshold=…:ratio=…:attack=5:release=300[ducked]`,
    dann `[ducked][mix]amix`.
  - `-map 0:v:0?` bleibt, `-map '[aout]'` ersetzt `-map 0:a:0?`; ohne Board
    bleibt der bisherige Pfad unverändert.
- Backpressure-Schutz: Der Engine schreibt mit begrenztem Puffer; Stockt die
  Mischung oder ffmpeg, fällt er auf Stille zurück, statt den Sink zu blockieren
  (kein `write` ohne Drain, Timeout + Resync auf 20-ms-Frames).
- Die Mischung läuft im Sink, deshalb sind Pause-/Startbildschirm, lokale
  Videos und Live-Quelle gleichermaßen abgedeckt. Die Live-Vorschau
  (`/api/preview.ts`) zeigt weiterhin nur die Quelle; das wird dokumentiert.

### Assets

- Ablage unter `data/sounds/` (gitignored) plus `data/sounds/index.json`
  (Modus `0600`): `id`, `name`, `file`, `kind` (`sfx`/`music`), `duration`,
  `gain_db`, `color`, `hotkey`, `created_at`.
- Upload über `POST /api/soundboard/sounds` (multipart, max. 50 MB) mit
  Magic-Byte-/`ffprobe`-Prüfung (mp3, wav, ogg, m4a, flac, opus), Dauerlimit
  (SFX ≤ 60 s, Musik ≤ 15 min) und normalisiertem Dateinamen.
- Dekodierung: ffmpeg erzeugt beim ersten Abspielen PCM 48k/Stereo; Cache im
  Speicher (LRU, `settings.soundboard.cache_mb`, Default 128) und optional als
  Datei unter `data/sounds/cache/`. Dateien mit falscher Samplerate/Kanälen
  werden sauber umgerechnet, nicht abgelehnt.
- Löschen/Umbenennen über `DELETE`/`PUT /api/soundboard/sounds/:id`; laufende
  Wiedergaben werden beim Löschen gestoppt.

### Wiedergabe

- **SFX-Pads:** mehrere Sounds gleichzeitig (`settings.soundboard.max_concurrent`,
  Default 4), eigenes Gain pro Sound, sanftes Fade-out (10 ms) gegen Klicks.
- **Musik:** ein Musikbett mit Loop (`off`/`one`/`all` über eine kleine
  Playlist), Crossfade 300 ms zwischen Titeln, eigenes Gain, „nächstes/Stopp“.
- **Master:** Gesamtlautstärke, „Alles stoppen“, Pause/Resume des Musikbetts.
- State (`SoundboardState`) mit `playing[]`, `music` (Titel, Position, Loop),
  `master_gain_db`, `ducking`; SSE-Event `soundboard` hält das Dashboard aktuell.

### API

| Route | Zweck |
|---|---|
| `GET /api/soundboard` | Sounds, laufende Wiedergaben, Musikstatus |
| `POST /api/soundboard/sounds` | Upload (multipart) |
| `PUT /api/soundboard/sounds/:id` | Name, Gain, Farbe, Hotkey, Musikmodus |
| `DELETE /api/soundboard/sounds/:id` | Entfernen |
| `POST /api/soundboard/play/:id` | SFX abspielen (optional `gain_db`, `target: 'sfx'\|'music'`) |
| `POST /api/soundboard/stop` | alles stoppen (`?scope=sfx\|music\|all`) |
| `POST /api/soundboard/music/next` | nächster Musiktitel |
| `POST /api/soundboard/volume` | Master-/SFX-/Musik-Gain |

Einstellungen: `settings.soundboard` (`enabled`, `ducking`, `duck_db`,
`master_gain_db`, `sfx_gain_db`, `music_gain_db`, `max_concurrent`, `cache_mb`),
Schema + Settings-UI + OpenAPI.

### Oberfläche

- Neue Route **`/soundboard`** unter „Inhalte“ (zweite Navigationsebene):
  Pad-Raster (Name, Farbe, Hotkey, Dauer), Musikliste mit Loop/Crossfade,
  Master-Slider, „Alles stoppen“, Upload-Dropzone, Kontextmenü pro Sound.
- Hotkeys (1–9, Q–P) nur bei fokussierter Seite, damit sie nicht mit dem
  Cockpit-Transport kollidieren; Pad-Buttons ≥ 64 px, `aria-pressed` beim
  Abspielen, Live-Pegelanzeige optional.
- Cockpit: kleiner „Soundboard“-Widget mit den vier häufigsten Pads und
  „Stopp“; kein eigener Transport.
- Stream Deck: Aktionen „Sound abspielen“ (Sound-Auswahl), „Stopp“,
  „Musik weiter“.
- Telegram: `/sound <name|id>`, `/soundstop`, `/music <name>` mit denselben
  Rechten wie andere Regie-Aktionen.
- MCP: `relay_soundboard_state`, `relay_soundboard_play`,
  `relay_soundboard_stop`.

### Tests & Doku

- Unit: Mixer (Überlagerung, Clipping/Limiter, Fade, Loop, LRU-Cache),
  `buildSinkCommand` mit/ohne Audio-Pipe (Mapping, Graph, Ducking),
  Upload-Validierung (Magic Bytes, Dauer, Namensnormalisierung).
- Integration: Sink-Start mit Board schreibt Stille ohne Lücken; Triggern
  während eines laufenden Fake-Sinks löst **keinen** Neustart aus.
- E2E: Pad abspielen/stoppen, Musik-Loop, Upload-Fehler, 320-px-Layout der
  Soundboard-Seite.
- `AGENTS.md`-Invariante (fd 5, Mischung im Sink, Ducking, kein Sink-Restart)
  und README-Abschnitt mit Bedienung und Grenzen.

## Akzeptanzkriterien

- [ ] Sounds und Musik sind hörbar im YouTube-Stream, parallel zur Quelle,
      ohne Unterbrechung oder Sink-Neustart.
- [ ] Mehrere SFX gleichzeitig plus Musikbett funktionieren; Master- und
      Einzelpegel wirken sofort.
- [ ] Ducking senkt die Quelle hörbar ab, solange ein Sound spielt, und
      schaltet danach weich zurück (abschaltbar).
- [ ] Hochladen, Umbenennen, Löschen und Hotkeys funktionieren im Dashboard;
      ungültige Dateien werden mit klarer Meldung abgelehnt.
- [ ] Board bleibt während Pause-/Startbildschirm und lokalen Videos nutzbar.
- [ ] Stream Deck, Telegram und MCP können Sounds auslösen und stoppen.
- [ ] Ohne aktives Board verhält sich der Sink exakt wie bisher (keine
      zusätzliche Pipe, gleiche Latenz).
- [ ] `npm run check`, `npm run build`, `npm run test:e2e` grün.

## Abgrenzungen

- Keine TTS-/Sprachausgabe und kein Musik-Streaming von externen Diensten
  (nur lokale Uploads).
- Keine Änderung an der TikTok-Quelle oder am Relay; die Vorschau bleibt
  quellennah ohne Board-Audio.
- Keine automatische Musikbett-Playlist aus den Regie-Videos; das Board ist
  eine eigene Bibliothek.
- Kein Multi-User-Mixing pro Zuschauer (kein „Mute für Zuschauer“).

## Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Pipe schreibt nicht rechtzeitig → Sink stockt | Durchgehende Stille, begrenzter Puffer, Timeout + Resync statt blockierendem `write` |
| Klicks/Peaks beim Start/Stopp | 10-ms-Fades, Limiter (`alimiter`) vor dem Encoder |
| Hohe CPU durch Dekodieren langer Musik | PCM-Cache mit LRU, Datei-Cache, max. Dauer 15 min |
| Audio-Desync nach Pausen | Mix im Sink (nicht im Relay), `aresample=async` bleibt vor der Mischung |
| Zu laute oder zu leise Uploads | Normalisierung beim Dekodieren (`loudnorm` einmalig) + Gain pro Sound |
| Rechte an hochgeladener Musik | Hinweis im UI: nur eigenes/lizenziertes Material verwenden |
