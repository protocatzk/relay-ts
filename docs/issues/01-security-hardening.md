## Ziel

Schreibende Dashboard-Anfragen mit Cookie-Auth gegen fremde Origins absichern
und Token nicht länger in URLs transportieren.

## Ausgangslage

- Cookie-Auth nutzt `SameSite=Lax`; ein expliziter Origin-/Referer-Check fehlt.
- API-Token werden für SSE/Status zusätzlich als Query-Parameter akzeptiert.
- Fastify läuft mit `trustProxy: false`; hinter nginx-proxy sehen Rate-Limit und
  Logs oft nur die Proxy-IP.

## Umfang

- Origin-/Referer-Prüfung für `POST`, `PUT`, `PATCH` und `DELETE`, wenn die
  Anfrage ausschließlich per Cookie authentifiziert ist.
- Query-Token für API/SSE deprecaten oder durch kurzlebige, signierte SSE-Tokens
  ersetzen.
- Trusted-Proxy-Konfiguration (`TRUST_PROXY` o. ä.) einführen und echte
  Client-IPs für Rate-Limits/Logs verwenden.
- Tests für fremde Origins, erlaubte Proxy-Header und Token-URLs ergänzen.
- Doku und `.env.example` aktualisieren.

## Akzeptanzkriterien

- [ ] Schreibender Cookie-Request mit fremdem `Origin` erhält `403`.
- [ ] Requests ohne `Origin`/`Referer` bleiben für CLI-Tools nutzbar.
- [ ] API-Token erscheint nicht mehr in URL-Beispielen oder Logs.
- [ ] Rate-Limit nutzt hinter dem konfigurierten Proxy die echte Client-IP.
- [ ] `npm run check` ist grün und die neuen Fälle sind getestet.
