## Ziel

Pause-, Reconnect- und Playlist-Übergänge automatisiert mit echten
Prozessgrenzen testen.

## Ausgangslage

Die meisten Tests sind Unit-Tests. Es gibt keinen Test, der einen
Quellenabbruch, Pausenscreen und Sink-Verbindung als Ablauf prüft.

## Umfang

- Fake-`ffmpeg`/`yt-dlp`-Binaries für kontrollierbare Events.
- Szenarien:
  - Quelle endet → Pausenscreen startet nach Grace-Periode.
  - Sink bleibt aktiv, während Pause läuft.
  - Reconnect erfolgreich → Pause stoppt, Quelle übernimmt.
  - Auto-Reconnect deaktiviert → Pause bleibt bis `max_minutes`.
  - Playlist-Advance während Offline.
- CI-Job für die Integrationssuite.

## Akzeptanzkriterien

- [ ] Mindestens die fünf genannten Szenarien laufen in CI.
- [ ] Der Test prüft Relay-/Sink-Zustand, nicht nur Logs.
- [ ] Laufzeit bleibt unter einem sinnvollen CI-Limit.
- [ ] Keine echten TikTok-/YouTube-Netzwerkzugriffe im Test.
