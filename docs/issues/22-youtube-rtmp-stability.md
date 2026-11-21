## Ziel

Das ausgehende Signal zum YouTube-RTMP-Endpoint (`YouTubeSink` / `buildSinkCommand`) dauerhaft stabilisieren, sodass YouTube Live keine Pufferungs-Warnungen, FPS-/Keyframe-Fehler oder unerwartete Verbindungsabbrüche meldet.

## Hintergrund

- Trotz bestehendem `DelayBuffer` und `YouTubeSink` (`src/core/sink/youtube-sink.ts`, `src/core/source/ffmpeg.ts`) können schwankende TikTok-Eingangsframeraten, unregelmäßige PTS/DTS-Übergänge bei Quellenwechseln/Pausen, VBR-Spitzen oder fehlendes Audio-Resampling den YouTube-RTMP-Ingest destabilisieren.
- YouTube erwartet einen strikt konstanten Takt: feste GOP-Länge (2 s Keyframe-Intervall), gleichmäßige Frame-Rate (CFR), kontinuierlichen Audio-Takt und eingehaltene VBV/CBR-Bitraten-Grenzen (`maxrate`/`bufsize`).

## Umfang

- **Timestamp- & Takt-Stabilisierung (`buildSinkCommand`):**
  - Konstante Framerate (`-fps_mode cfr` bzw. `fps`-Filter) und saubere PTS/DTS-Generierung prüfen/erzwingen (`-fflags +genpts`, `-avoid_negative_ts make_zero`).
  - Audio-Kontinuität über `aresample=async=1:first_pts=0` (bzw. konstante Sample-Rate/Channels) sicherstellen, damit PTS-Lücken zwischen Quelle, PauseScreen und `file:`-Videos keinen Audio-Drift erzeugen.
- **Encoder- & RTMP-Härtung:**
  - Striktes Keyframe-Intervall (exakt `2 * fps` / `-force_key_frames "expr:gte(t,n_forced*2)"` oder äquivalente Encoder-Flags für `libx264`, `h264_nvenc`, `h264_qsv`, `h264_amf`) und sauberes VBV/CBR-Pacing (`maxrate`, `bufsize`).
  - RTMP-/TCP-Socket-Verhalten und ffmpeg-Reconnect/Timeout-Optionen (`-rw_timeout`, `-flvflags no_duration_filesize`, RTMP-Keepalive) prüfen und dokumentieren.
  - Optionales Fallback-/Watchdog-Verhalten im `YouTubeSink` bei RTMP-Stall oder wiederholten `non-monotonous DTS`-Meldungen verbessern.
- **Diagnose & Tests:**
  - Sink-Stabilitätsmetriken (Dropped Frames, Bitrate-Varianz, RTMP-Reconnects, `lastError`) in `/health` und `DiagnosticsView.vue` klar darstellen.
  - Tests in `tests/ffmpeg.test.ts` und `tests/youtube-sink.test.ts` erweitern.

## Akzeptanzkriterien

- [ ] Sink-Output liefert konstante CFR, 2-s-Keyframes, kontinuierliches Audio und eingehaltene VBV/CBR-Grenzen über alle unterstützten Encoder hinweg.
- [ ] Quellenwechsel (TikTok → PauseScreen → TikTok / `file:`-Video) erzeugen keine `non-monotonous DTS`-Abbrüche am RTMP-Endpoint.
- [ ] RTMP-Ingest-Metriken/Fehler sind im Dashboard und in `/health` nachvollziehbar.
- [ ] `npm run check` grün.
