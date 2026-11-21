## Ziel

Die Audio-Encoding- und Filter-Parameter des ausgehenden YouTube-Sinks (`YouTubeSink` / `buildSinkCommand`) für Apple iOS-Clients (offizielle YouTube-App auf iOS / iPadOS) verifizieren und stabilisieren, um Tonaussetzer, Stottern oder Stille auf Apple-Geräten dauerhaft zu verhindern.

## Hintergrund

- Nutzer berichten von Audioproblemen speziell in der YouTube-App unter iOS, während Desktop-Browser den Stream fehlerfrei abspielen.
- Apples AVFoundation / CoreAudio-Engine in iOS stellt besonders strikte Anforderungen an AAC-kodierte Live-Streams:
  - Feste Sample-Rate: Springt die Audio-Samplerrate oder fehlen saubere Audio-Header, kappt iOS die Tonausgabe komplett.
  - AAC-Profil & Channel Layout: Zwingend erforderlich sind standardkonformes AAC-LC (`-c:a aac -profile:a aac_low`), konstantes Stereo-Layout (`-ac 2`) und 48.000 Hz Samplingrate (`-ar 48000`).
  - Audio-Filterkette: Bei digitaler Stille oder Quellwechseln können Filter wie `loudnorm` oder `aresample` NaN-Samples oder PTS-Gaps erzeugen. Während Desktop-Clients dies oft überbrücken, stürzt der CoreAudio-Audiodekoder ab oder schaltet stumm.

## Umfang

- **Audio-Sink-Härtung (`src/core/source/ffmpeg.ts` `buildSinkCommand`):**
  - Audio-Encoder-Flags strikt fixieren: `-c:a aac -profile:a aac_low -b:a 128k -ar 48000 -ac 2`.
  - Resampling-Optionen prüfen: `aresample=async=1000:min_comp=0.01:min_hard_comp=0.2:first_pts=0`.
  - Vorab-Prüfung von `dcshift=0.00001` bei `loudnorm`, um NaN-Werte auf Stille auszuschließen.
  - Überprüfung der FLV/RTMP-Interleaving-Parameter (`-max_interleave_delta 500000`), damit Audio- und Videopakete für iOS nicht auseinanderlaufen.
- **Analyse & Tests:**
  - FFprobe- und Audio-Bitstream-Inspektion auf ADTS-/AudioSpecificConfig-Konsistenz.
  - Unit-Tests in `tests/ffmpeg.test.ts` und `tests/youtube-sink.test.ts` zur Validierung aller Audio-Flags und Encoder-Optionen.

## Akzeptanzkriterien

- [ ] Der Sink liefert konsistentes AAC-LC mit 48 kHz Stereo und lückenlosen PTS-Zeitstempeln.
- [ ] Keine Audio-Diskontinuitäten oder NaN-Pakete bei Quellenwechseln, Pausenscreen oder Stille.
- [ ] Wiedergabe in der iOS YouTube-App läuft unterbrechungsfrei ohne Stottern oder Tonausfall.
- [ ] `npm run check` grün; erweiterte Audio-Tests sichern das Verhalten dauerhaft ab.
