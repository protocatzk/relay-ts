## Ziel

Betrieb und Fehlersuche mit Metriken, klaren Health-Details und Backup-Hilfen
verbessern.

## Umfang

- Prometheus-kompatibler `/metrics`-Endpunkt oder JSON-Metriken.
- Zähler für:
  - Source-Reconnects und Pausen
  - Sink-Restarts
  - Watchdog-Auslöser
  - Chat-/Earnings-Poll-Fehler
- `/health` um Source-/Relay-/Sink-/Pause-Details erweitern.
- Script für Backup/Restore von `config/` und `data/` (ohne Secrets zu loggen).
- Logrotation für `logs/restreamer.log` dokumentieren.

## Akzeptanzkriterien

- [ ] Metriken sind ohne zusätzliche Abhängigkeit abrufbar.
- [ ] Health zeigt den Zustand der wichtigsten Subsysteme.
- [ ] Backup-Script erzeugt ein wiederherstellbares Archiv.
- [ ] Doku beschreibt Metriken, Backup und Rotation.
