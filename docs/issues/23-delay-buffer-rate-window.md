## Ziel

Die CPU-Last des Delay-Buffer-Ticks senken, indem die Pacing-Raten-Messung in `src/core/relay/delay-buffer.ts` von einer pro-Entry-Iteration über das gesamte 60-s-Fenster auf pro-Sekunden-Buckets umgestellt wird.

## Hintergrund

- `DelayBuffer.tick()` läuft über `setInterval` alle 10 ms (`TICK_MS`) und ruft dabei `measureRate()` auf.
- `measureRate()` iteriert bei jedem Tick über alle Entries im 60-s-Fenster (`this.arrivals` und `this.forwarded`) und entfernt abgelaufene Entries per `Array.shift()` (O(n) pro Element).
- Der Eingang (= MPEG-TS-Ausgabe des Quell-ffmpeg) liefert burstig viele Chunks pro Sekunde; das Fenster kann dadurch mehrere tausend Entries enthalten. Das ergibt eine dauerhafte CPU-Basislast, die mit der Chunk-Rate, nicht mit der eigentlichen Arbeit skaliert.
- Die gemessene Rate selbst ändert sich kaum innerhalb einer Sekunde – eine Sekunden-Auflösung ist fürs Pacing ausreichend.

## Umfang

- **DelayBuffer (`src/core/relay/delay-buffer.ts`):**
  -.Bytes pro Sekunde in einer kompakten Struktur (z. B. `Map<sekundenKey, bytes>`) aggregieren statt einzelne `{ at, bytes }`-Entries vorzuhalten.
  - `measureRate()` über die letzten 60 Buckets summieren; Pruning ist dann O(60) pro Tick statt O(Entries).
  - `rateFrom()` (Stats-Anzeige) analog auf Buckets umstellen.
  - Prüfen, ob der Tick-Timer `.unref()` bekommen sollte, damit er den Prozess nicht am Beenden hindert.
- **Tests:**
  - Bestehende Pacing-Unit-Tests bleiben ohne Anpassung grün.

## Akzeptanzkriterien

- [ ] `measureRate()` iteriert nicht mehr pro Entry über das gesamte 60-s-Fenster; die Kosten pro Tick sind unabhängig von der Chunk-Rate.
- [ ] Pacing- und Catch-Up-Verhalten (inkl. `pacingKbps` in `stats()`) bleibt funktional identisch.
- [ ] Benchmark-/Performanz-Test zeigt konstante Tick-Kosten bei deutlich erhöhter Chunk-Rate.
- [ ] `npm run check` grün.
