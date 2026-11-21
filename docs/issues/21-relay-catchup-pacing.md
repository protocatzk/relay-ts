## Ziel

Überschüssige Puffer im `DelayBuffer` (`src/core/relay/delay-buffer.ts`) kontrolliert und unmerklich abbauen, indem bei Puffer-Überhang ein leichter Catch-Up-Faktor (z. B. `1.01x`) auf das Pacing erzwungen wird, bis die Ziel-Verzögerung (`delaySeconds`) wieder erreicht ist.

## Hintergrund

- `DelayBuffer` hält eingehende MPEG-TS-Pakete für `delaySeconds` zurück und gibt sie gedrosselt mit der gemessenen Quell-Bitrate weiter.
- Nach Netzwerk-Bursts, kurzen Sink-Stockungen oder Quellenwechseln kann die tatsächliche Puffer-Latenz dauerhaft über `delaySeconds` anwachsen, weil die Ausgabe exakt mit `1.0x` der Eingangsrate weiterläuft und den Rückstand nie aufholt.
- Ein sanftes Catch-Up-Pacing (z. B. `1.01x` – bzw. konfigurierbar bis max. `1.02x` bei größerem Überhang) baut den Überschuss kontinuierlich ab, ohne Audio-/Video-Glitches oder YouTube-Ingest-Spikes auszulösen.

## Umfang

- **DelayBuffer (`src/core/relay/delay-buffer.ts`):**
  - Effektive Puffer-Verzögerung (`head`-Alter bzw. gepufferte Sekunden) laufend gegen `delaySeconds` messen.
  - Überschreitet der Puffer die Ziel-Latenz (z. B. `> delaySeconds + 0.5 s`), Pacing-Rate automatisch auf `1.01x` (konfigurierbar) anheben, bis `delaySeconds` wieder erreicht ist; bei `enabled: false` bzw. `delaySeconds: 0` ebenfalls auf `1.01x` abbauen, sobald Backlog entsteht.
  - Schutz gegen Leerlauf/Underrun: unterhalb von `delaySeconds` strikt bei `1.0x` bleiben (oder leicht bremsen, falls `queue` unter Ziel-Schwelle fällt).
- **Observability & Tests:**
  - Aktuelle Puffer-Latenz (`buffer_delay_seconds`) und aktiven Catch-Up-Faktor (`pacing_multiplier`) in `DelayBuffer.stats()` / `/health` / `/api/metrics` ausweisen.
  - Unit-Tests in `tests/delay-buffer.test.ts` für Puffer-Aufbau → `1.01x`-Abbau → Rückkehr auf `1.0x` ohne Paketverlust.

## Akzeptanzkriterien

- [ ] Ein künstlich aufgebauter Puffer-Überhang wird automatisch mit `1.01x` bis auf `delaySeconds` abgebaut.
- [ ] Keine PTS-/DTS-Sprünge, kein Paket-Drop unterhalb von `maxBytes` und kein Underrun am Sink-Übergang.
- [ ] Puffer-Latenz und Catch-Up-Status sind in `/health` sichtbar.
- [ ] `npm run check` grün; neue Unit-Tests in `tests/delay-buffer.test.ts`.
