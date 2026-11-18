## Ziel

Den Supervisor in klar abgegrenzte Controller aufteilen und Zustandswechsel
explizit machen.

## Ausgangslage

`src/core/supervisor/supervisor.ts` ist ca. 1.750 Zeilen lang und enthält
Streaming, Reconnect, Pause, Playlist, Overlays, Earnings und Settings.

## Umfang

- Zustandsmaschine für `idle`, `starting`, `live`, `reconnecting`, `paused`,
  `stopping`, `error` mit erlaubten Übergängen.
- Extraktion in z. B. `StreamSession`, `PauseController`,
  `PlaylistController`, `ReconnectPolicy`, `OverlayRuntime`.
- Kein Verhaltenswechsel; öffentliche Supervisor-API bleibt stabil.
- Unit-Tests für Übergänge, insbesondere Pause, Reconnect und Playlist-Ende.

## Akzeptanzkriterien

- [ ] Zustandsübergänge sind zentral definiert und getestet.
- [ ] `supervisor.ts` enthält keine Detailimplementierung der Subcontroller.
- [ ] Bestehende Tests laufen unverändert bzw. mit minimalen Anpassungen.
- [ ] Pause-/Reconnect-Verhalten bleibt funktional identisch.
