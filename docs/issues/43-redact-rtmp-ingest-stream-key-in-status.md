# Issue 43: RTMP-Ingest-Stream-Key nicht im Status-Snapshot ausliefern

## Ziel

Der Status-Snapshot baut für den RTMP-Ingest die URL inkl. Klartext-Stream-Key (`ingest_url: rtmp://<host>:<port>/live/<stream_key>`). Der Key soll – wie alle anderen Secrets (Pattern `api_key_set`, `stream_key_set`) – durch einen Redaktions-Marker ersetzt werden.

## Hintergrund

- `Supervisor.buildStatus()` (`src/core/supervisor/supervisor.ts`) fügt `ingest_url` mit dem echten `settings.rtmp_ingest.stream_key` zusammen.
- Der Snapshot geht über SSE an alle verbundenen Dashboards und über `GET /api/status` an beliebige (authentifizierte) Clients – inklusive API-Keys mit minimalem Scope (vgl. Issue 40).
- Auth schützt den Zugriff, aber der Key belastet Kopien (Browser-Speicher, Client-Logs, Exporte) und widerspricht dem eigenen Prinzip „Secrets erscheinen nie in API-Antworten".

## Umfang

- Der Key wird durch einen Marker ersetzt (z. B. `stream_key_set: true`, `ingest_url: rtmp://<host>:<port>/live/<set>`).
- Praktische Zugänglichkeit erhalten: Dedizierter geschützter Endpunkt (z. B. `GET /api/settings`-Antwort oder ein einmaliger „reveal"-Aufruf), aus dem das Dashboard den Key für die Anwendungsfall-Kopieren-Funktion bezieht.
- Prüfen, ob Status-Snapshots in Log-zusammenfassungen/Diagnoseberichten landen können; andernfalls entschärfen.

## Akzeptanzkriterien

- [ ] `GET /api/status` und SSE-Snapshots enthalten den RTMP-Ingest-Key weder im Klartext noch als Teil der `ingest_url`.
- [ ] Das Dashboard kann den Ingest-Key für den Kopieren-Button weiterhin abrufen (geschützter Endpunkt).
- [ ] Typen (Schema, API-Types, Frontend-Types) und Tests sind aktualisiert (Regel aus `AGENTS.md`: Neue Backend-Felder überall ergänzen).
- [ ] `npm run check` grün.
