# OpenAPI

Die HTTP-API wird als OpenAPI-3.1-Dokument gepflegt. Die Quelle ist
`src/api/openapi.ts`; die eingecheckte Datei liegt unter `docs/openapi.json`.

## Erzeugen und prüfen

```bash
npm run openapi:generate   # docs/openapi.json neu schreiben
npm run openapi:check      # CI-Check: Datei muss aktuell sein
```

`npm run check` und die GitHub-CI führen `openapi:check` aus. Der Test
`tests/openapi.test.ts` stellt zusätzlich sicher, dass jede registrierte
`/api`-Route im Dokument vorkommt und alle `$ref`-Verweise auflösbar sind.

## Abruf

- `GET /api/openapi.json` liefert die Spezifikation.
- Der Endpunkt liegt unter `/api` und ist damit durch die normale
  API-Authentifizierung geschützt.
- Eine Swagger-UI ist bewusst nicht eingebunden. Die Spezifikation kann
  extern (z. B. mit Swagger Editor oder Redoc) geöffnet werden.

## Authentifizierung

Definiert sind drei Sicherheitsschemata:

| Schema | Art |
|---|---|
| `cookieAuth` | Session-Cookie `relay_session` |
| `bearerAuth` | `Authorization: Bearer <API-TOKEN>` |
| `basicAuth` | Basic Auth mit Passwort oder API-Token |

Öffentlich bleiben nur Health-Check, Auth-Methoden/-Login, Telegram-Login und
der Google-OAuth-Callback. Alle anderen Endpunkte erben die globale
`security`-Vorgabe.

## Neue Routen

1. Route in `src/api/routes/` registrieren.
2. Metadaten in `src/api/openapi.ts` ergänzen.
3. `npm run openapi:generate` ausführen.
4. `npm run check` ausführen – der Route-Coverage-Test schlägt bei fehlenden
   oder überzähligen Einträgen fehl.

## Typisierter Client

Der manuelle Client in `src/web/src/api/client.ts` bleibt vorerst die
Quelle der Frontend-Typen. Die Kopplung an die API erfolgt über den
Route-Coverage-Test, das eingecheckte Dokument und den Typ-Paritätstest in
`tests/type-parity.test.ts` (Backend-Payloads müssen zu den
Frontend-Ressourcentypen passen). Ein vollständig generierter Client kann
später aus `docs/openapi.json` abgeleitet werden.
