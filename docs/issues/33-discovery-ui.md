## Ziel

Dashboard-UI für den Discovery-Modus aus #65: eigener Tab mit Suchleiste, Streamer-Karten, Live-Status und Quick-Actions. Der UI-Schritt startet erst nach dem Service-Grundgerüst (#69 bzw. Design-Doku [`docs/design/DISCOVERY-PROVIDERS.md`](../design/DISCOVERY-PROVIDERS.md)).

## Hintergrund

- Discovery-Streamer sind Kandidaten, keine festen Kanäle — sie fluten deshalb nicht `StreamersView`, sondern bekommen eine eigene View.
- Der Service liefert die Datenstruktur `{ hits, providers }`: Offline-/Limit-Zustände sollen in der UI sichtbar werden, nicht versteckt.

## Umfang

- **DiscoveryView (`src/web/src/views/DiscoveryView.vue`):**
  - Suchleiste (Suchbegriff/Hashtag) und Toggle "Trending" (Region/Sprache-Filter aus Settings) — Treffer/Fehlschläge ohne Loading-Blocker.
  - Karten mit Live-Badge, Zuschauerzahl, Titel, Avatar, Provider-Herkunft (`source`).
  - Quick-Buttons: "Jetzt umschalten", "In Queue", "Als Streamer speichern".
  - Provider-Status-Badges aus `providers`-Response (online/offline/rate-limited) — AK "Rate-Limits und Offline-Zustände transparent".
- **Anbindung:**
  - Live-Status-Refreshes über den bestehenden EventBus: ein `discovery`-Event pro Cache-Aktualisierung bedient alle offenen Dashboards — kein per-Client-Polling-Storm.
  - Detail-Refreshes (`room/:handle`) nur on-demand bzw. bei sichtbaren Karten (Sichtbarkeit-Prinzip wie in #57).
  - "Jetzt umschalten" ruft vor dem Wechsel einen frischen Live-Check auf; offline → klarer Hinweis statt stiller Fehlschlag.
- **Bestätigungs-Dialog beim Add:**
  - Discovery-Streamer werden per Default `enabled: false, priority: 999` angelegt (Service-Guard); die UI zeigt dies klar an ("in Liste (aus)") und bietet den zweiten, bewussten Klick "Jetzt aktivieren".
- **Barrierefreiheit (AK #65):**
  - Karten-Grid als fokussierbare Liste; Tastatur-Bedienung (Tab/Enter/Space) für alle Actions; Live-Badge/Status barrierefrei beschriftet; Kontraste im TokTracker-Design.
  - Screenreader-Beschriftungen wie sonst im Dashboard.

## Akzeptanzkriterien

- [ ] Discovery-Tab zeigt Suche/Trending mit Live-Status, Viewer, Titel, Provider-Herkunft.
- [ ] Alle drei Quick-Actions funktionieren end-to-end mit Service (#69) und landen im Audit-Log.
- [ ] Offline-/Rate-Limit-Zustände der Provider werden sichtbar degradiert (Badge + Hinweis), kein Crash-State in der UI.
- [ ] Tastatur- und Screenreader-Bedienung der Karten und Aktionen; Kontraste geprüft.
- [ ] Kein Polling-Storm: ein `discovery`-Event bedient alle Dashboards; keine Refreshes bei verstecktem Tab.
- [ ] `npm run check` und `npm run test:e2e` grün.
