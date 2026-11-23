# Issue 42: `x-forwarded-proto` nur bei vertrauenswürdigem Proxy für Secure-Cookie-Entscheidung nutzen

## Ziel

`isSecureRequest` in `src/api/auth.ts` bestimmt aktuell anhand des `x-forwarded-proto`-Headers, ob Session-Cookies mit `secure` gesetzt werden – ohne zu prüfen, ob der Reverse-Proxy vertrauenswürdig ist (`TRUST_PROXY`).

## Hintergrund

- `isSecureRequest` liest `x-forwarded-proto` uneingeschränkt; `trustProxy` wird nur von Fastify selbst (IP-Erkennung) berücksichtigt.
- Läuft RELAY ohne Proxy (`TRUST_PROXY=false`), kann ein direkter Client den Header fälschen und das Login zwingt das Secure-Flag ins Setzen (bzw. beeinflusst Cookie-Verhalten) – im Klartext-HTTP-Fall hätte der Cookie fälschlich/missing Secure-Flags je nach Richtung.
- In der Produktivumgebung (Caddy) ist das unkritisch, aber der Code soll konsistent zum Konfigurationsversprechen sein: „`TRUST_PROXY=true` nur hinter einem vertrauenswürdigen Reverse-Proxy setzen".

## Umfang

- Server-Konfiguration um einen bereits geparsten `trustProxy`-Wert für die Auth-Logik erweitern oder `isSecureRequest` zusätzlich `config.server.trustProxy` prüfen lassen.
- Bei `trustProxy=false`: nur `secureCookies`-Konfiguration entscheiden, XFP-Header ignorieren.
- Test: Request mit gefälschtem XFP ohne Proxy-Konfiguration ändert das Cookie-Verhalten nicht.

## Akzeptanzkriterien

- [ ] Ohne `TRUST_PROXY` hat `x-forwarded-proto` keinen Einfluss auf das Secure-Flag von Sessions.
- [ ] Mit `TRUST_PROXY=true` bleibt das Verhalten wie bisher (Caddy-Setup).
- [ ] `npm run check` grün, inkl. ergänzendem Unit-Test in `tests/auth-sessions.test.ts`.
