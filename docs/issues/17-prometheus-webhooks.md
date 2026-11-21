## Ziel

Professionelles Monitoring über Prometheus/OpenMetrics sowie proaktive Benachrichtigungen per HTTP-Webhook (Discord, Slack oder generisches JSON) zusätzlich zu Telegram.

## Hintergrund

- `src/core/metrics.ts` pflegt bereits Prozess-Zähler (`source_exits_total`, `sink_restarts_total`, etc.) und liefert sie als JSON unter `GET /api/metrics`.
- Benachrichtigungen über Ausfälle, Pause-Limits oder YouTube-Token-Probleme sind aktuell fest an Telegram gekoppelt.

## Umfang

- **Prometheus / OpenMetrics:**
  - `GET /api/metrics?format=prometheus` (oder `Accept: text/plain; version=0.0.4`) liefert standardkonforme `COUNTER`- und `GAUGE`-Metriken (inkl. aktuellem Stream-State, aktiver Quelle, Reconnect-Versuch, Queue-Länge, Recording-Bytes).
- **Alerting-Webhooks:**
  - Konfigurierbare Webhook-Ziele in `settings.yml` (URL, optional Secret/HMAC-Signatur oder Discord-Embed-Format, auswählbare Event-Typen: `stream_error`, `pause_limit`, `reconnect_failed`, `youtube_auth_required`, `disk_warning`).
  - Asynchroner Versand mit kurzem Timeout und Rate-Limit/Cooldown, damit ein langsamer Webhook niemals den Supervisor blockiert.
  - „Test-Webhook senden"-Button in den Einstellungen.

## Akzeptanzkriterien

- [ ] Prometheus-Output ist valides OpenMetrics/Textformat und enthält alle bestehenden sowie Stream-State-Gauges.
- [ ] Webhook-URLs werden in API-Antworten maskiert (analog zu Secrets) und im Redactor geschützt.
- [ ] Fehlerhafte/langsame Webhooks beeinträchtigen den Stream-Betrieb nicht.
- [ ] Tests für Metrik-Formatierung und Webhook-Dispatch; `npm run check` grün.
