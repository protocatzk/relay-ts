## Ziel

Das 2-s-Status-Emit (`emitStatus()`) nur dann ein vollständiges Status-Snapshot-Objekt bauen und serialisieren lassen, wenn mindestens ein Dashboard (SSE-Client) verbunden ist.

## Hintergrund

- `supervisor.ts` startet einen `setInterval` mit 2000 ms, der immer `emitStatus()` aufruft, egal ob Dashboards verbunden sind.
- `emitStatus()` baut über `buildStatus()` das komplette Snapshot-Objekt; der Event-Bus serialisiert die Daten zu JSON.
- Der SSE-Fanout in `src/api/routes/system.ts` ist bereits optimiert (eine geteilte Bus-Subscription, Coalescing pro Tick) – aber ohne verbundene Clients entsteht der komplette Build-/Serialisierungs-Aufwand trotzdem, rund um die Uhr, auch im Idle-Betrieb.
- Zusätzlich procct der Timer alle 5 Ticks `persistMediaProgress()` und liest den Recording-Disk-Status; das kann wie heute bleiben, nur der teure Snapshot-Bau soll entfallen.

## Umfang

- **Supervisor/API-Grenze:**
  - Anzahl verbundener SSE-Clients dem Supervisor zugänglich machen (z. B. Counter im ApiContext, den die `/api/events`-Route bei Connect/Disconnect pflegt, oder Client-Set im EventBus-Subscription-Layer).
  - `emitStatus()` bei 0 Clients überspringen; bei Verbindungs-Aufbau sofort einen Snapshot senden (macht die Route bereits selbst – Initial-Snapshot bleibt unverändert).
  - Dasselbe Kriterium für `emitAll()` prüfen (Queue-, Streamers-, Earnings-Events), sofern kein Ereignis-Anlass vorliegt.

## Akzeptanzkriterien

- [ ] Ohne verbundene Dashboards wird kein Status-Snapshot gebaut oder serialisiert (nachweisbar in Tests).
- [ ] Beim Verbinden eines Dashboards arriveiert sofort ein vollständiger, aktueller Snapshot.
- [ ] Update-Verhalten mit mindestens einem verbundenen Dashboard bleibt unverändert (2-s-Takt, Reaktionsfähigkeit auf Ereignisse).
- [ ] Webhook-/Watchdog-/Persistenz-Logik im Status-Timer bleibt funktional unverändert.
- [ ] `npm run check` grün.
