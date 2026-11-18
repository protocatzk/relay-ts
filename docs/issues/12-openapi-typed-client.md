## Ziel

Eine gepflegte OpenAPI-Dokumentation und einen daraus abgeleiteten typisierten
Client bereitstellen.

## Umfang

- OpenAPI aus Fastify-Routen/Zod-Schemas generieren.
- Endpunkte, Auth, Fehlerformat und Beispiele dokumentieren.
- Frontend-Client aus dem Schema typisieren oder zumindest per Typ-Test an das
  Schema koppeln.
- CI-Check, dass die Spezifikation baubar und aktuell ist.
- Swagger UI nur geschützt oder standardmäßig deaktiviert.

## Akzeptanzkriterien

- [ ] OpenAPI-Datei wird reproduzierbar erzeugt.
- [ ] Auth- und Fehlerantworten sind dokumentiert.
- [ ] CI erkennt veraltete Spezifikationen.
- [ ] Frontend-Typen weichen nicht unbemerkt vom Backend ab.
