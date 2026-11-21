## Ziel

Das Haupt-Logfile (`pino.destination`, `src/utils/logger.ts:287`) rotieren — es wächst im 24/7-Betrieb ohne Begrenzung, während der Audit-Log bereits rotiert.

## Hintergrund

- `createLogger()` legt bei konfiguriertem `logFile` eine `pino.destination` an (`sync: false`) und hängt Zeilen dauerhaft an (`src/utils/logger.ts:287`).
- Weder `scripts/`, `systemd/relay.service` noch eine Komponente im Code rotieren dieses File — kein `logrotate`-Drop-in, keine Größe/Anzahl-Logik.
- Der Audit-Log hat bereits Rotation (`AuditLogStore.rotateIfNeeded()`, `src/core/audit-log.ts:147`); das Haupt-Log nicht.
- Im Dauerbetrieb (Restream-Service) fallen Meldungen von Sink, Watchdog, Chat, Earnings, HTTP-Access-Log zusammen Tag für Tag an — je nach Log-Level schnell hundert MB pro Woche, auf kleinen VPSen ein echtes Disk-Risiko (`disk_warning` des Recordings überwacht nur `data/recordings`).
- Das Lesen im Dashboard ist bereits sicher gecappt (`readLogFileEntries` liest nur den letzten 2-MB-Tail) — das Problem ist rein die unbegrenzte Disk-Anlage.

## Umfang

- **Rotation im Code (bevorzugt, da Docker & systemd gleich profitieren):**
  - Nach jedem `flush()`/Zeitintervall prüfen: überschreitet das Logfile eine Größe (z. B. `logs.max_file_mb`, Default 20 MB), schließe die Destination, benenne das File zu `relay-<n>.log` um (Anzahl begrenzt, z. B. `logs.max_files`, Default 5) und öffne eine neue Destination.
  - Alternativ/ergänzend: Re-Open auf Signal (`USR1`-Pattern, wie bei pino üblich), damit systemd mit `logrotate` (copytruncate oder Signal) genutzt werden kann.
- **Konfiguration:** Globale Log-Einstellungen (`log_level` existiert bereits) um `log_file_mb`/`log_files` erweitern; Doku in README/AGENTS ergänzen.
- **Diagnostics:** `DiagnosticsView` zeigt Logfile-Größe an (nutzt vorhandene `statfs`-Infrastruktur) und warnt bei nahezu vollem Rotationsbudget.

## Akzeptanzkriterien

- [ ] Das Haupt-Logfile überschreitet konfigurierbare Größe/Anzahl nicht (nachweisbar per Unit-Test mit gefakten Schreiben).
- [ ] Rotierte Dateien bleiben für das Dashboard/Lese-Ring erreichbar oder verlieren keine aktuellen Zeilen (kein Zeilenverlust bei Rotation).
- [ ] Audit-Log-Rotation unverändert; Docker- und systemd-Deployments brauchen kein zusätzliches Setup.
- [ ] `npm run check` grün.
