# Issue 40: API-Key-Scopes für GET-Routen durchsetzen

## Ziel

Das Scope-Modell der konfigurierbaren API-Keys (Issue 39) muss auch für Lese-Zugriffe gelten. Aktuell werden Scopes ausschließlich bei schreibenden Methoden geprüft, wodurch die definierten `read:*`-Scopes wirkungslos sind.

## Hintergrund

- Die globale Auth-Hook in `src/api/server.ts` (onRequest) prüft Scopes nur für `POST/PUT/PATCH/DELETE` und nur per hartkodiertem Prefix-Matching (`/api/streamers`, `/api/queue`, `/api/screens`, `/api/overlays`, `/api/media`).
- GET-Requests mit einem gültigen API-Key werden unabhängig vom Scope zugelassen. Ein Key, der nur den Scope `control:queue` besitzt, kann damit `/api/settings`, `/api/logs/*`, `/api/recordings`, `/api/metrics` und den Audit-Log lesen.
- Die Scopes `read:status`, `read:streamers`, `read:recordings`, `read:logs` sind in `src/api/api-key-store.ts` definiert, werden aber nirgends erzwungen – der Feingranularitäts-Versprechen aus Issue 39 („Read-Only-Status-Monitor", „regiedienste ohne Systemzugriff") wird für den Lese-Pfad nicht eingelöst.

## Umfang

- Scope-Prüfung in der onRequest-Hook um GET-Routen erweitern, z. B.:
  - `/api/status`, `/api/metrics`, `/api/preview.ts`, `/api/overlays/preview.png` → `read:status`
  - `/api/streamers`, `/api/playlists` (GET) → `read:streamers`
  - `/api/recordings` (GET) → `read:recordings`
  - `/api/logs/*`, `/api/diagnostics`, `/api/audit` → `read:logs`
- Prüfidee langfristig: Scope pro Route deklarativ (Route-Option bzw. Tabelle) statt Prefix-Matching in der Hook; die OpenAPI-Definition liefert die Struktur bereits.
- `docs/openapi.json` / `src/api/openapi.ts` um Scope-Angaben ergänzen (`npm run openapi:generate`).
- Tests: Key mit minimalem Scope darf nur die freigegebenen GET-Routen erreichen, 403 für den Rest; Admin-Key unverändert.

## Akzeptanzkriterien

- [ ] Ein Key ohne `read:*`-Scope erhält auf geschützten Lese-Endpunkten `403 forbidden`.
- [ ] Die definierten `read:*`-Scopes werden tatsächlich erzwungen (keine Toten mehr im Modell).
- [ ] Bestehende Keys mit `*`/`admin` verhalten sich unverändert.
- [ ] Scope-Erwartungen sind in der OpenAPI-Datei dokumentiert; `npm run openapi:check` grün.
- [ ] `npm run check` grün, ergänzende Tests in `tests/api.test.ts` bzw. Api-Key-Tests.
