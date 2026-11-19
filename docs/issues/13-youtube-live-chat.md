## Ziel

Den YouTube-Live-Chat des aktiven Broadcasts nativ im Dashboard anzeigen, statt
ihn per iframe einzubetten.

## Hintergrund / Findings

- Der direkte iframe-Ansatz
  (`https://www.youtube.com/live_chat?v=<id>&embed_domain=<domain>`) ist für
  `relay.positronium.dev` **blockiert**: YouTube setzt `X-Frame-Options`/CSP
  `frame-ancestors` und erlaubt das Einbetten nur für freigeschaltete Domains.
  Es gibt keinen Self-Service-Whitelist-Eintrag mehr. → iframe ist keine
  tragfähige Option (Browser zeigt „Dieser Inhalt ist blockiert. Setze dich mit
  dem Websiteinhaber in Verbindung …").
- Das serverseitige OAuth (Scope `youtube.force-ssl`) deckt das **Lesen** des
  Live-Chats bereits ab – **kein neues Consent** nötig. `liveChatMessages.list`
  erfordert `youtube.readonly`, `youtube.force-ssl` oder `youtube`.
- `broadcast.id` ist bei Live-Streams identisch mit der Video-ID. Daraus lässt
  sich über `videos.list` (`part=liveStreamingDetails`) der
  `activeLiveChatId` ermitteln.
- Übergangsweise wurde der iframe durch einen „Chat öffnen"-Button (neuer Tab)
  ersetzt (Variante A). Dieses Issue beschreibt die vollwertige Variante B.

## Quota

| Operation | Einheiten |
|---|---|
| `liveChatMessages.list` (lesen) | 5 / Call |
| `videos.list` (`liveChatId` holen) | 1 (einmalig pro Live-Gang) |
| `liveChatMessages.insert` (senden, optional) | 50 / Nachricht |

Tagesbudget: **10.000 Einheiten** pro Projekt, geteilt mit Broadcasts/Transitions.

Polling-Kosten (nur während aktivem Zuschauen):

| Intervall | Einheiten/Stunde |
|---|---|
| 5 s | ~3.600 |
| 10 s | ~1.800 |
| 15 s | ~1.200 |

## Umfang

- Backend: `activeLiveChatId` ermitteln und `liveChatMessages.list` pollen.
- Route `GET /api/youtube/chat?broadcast_id=…` (JSON) oder SSE für Live-Updates.
- Frontend: eingebettete, schreibgeschützte Chat-Ansicht im TokTracker-Look
  (Autor, Avatar, Nachricht), ersetzt den blockierten iframe.
- Polling **nur** bei geöffneter Karte **und** sichtbarem Tab (Page Visibility
  API) und nur wenn ein Broadcast live ist. Kein Polling im Leerlauf.
- Optional: Nachrichten senden als Kanal (`liveChatMessages.insert`, 50 E).

## Akzeptanzkriterien

- [ ] Chat-Nachrichten des aktiven Broadcasts erscheinen im Dashboard.
- [ ] Polling stoppt bei geschlossenem/verstecktem Panel und ohne Live-Broadcast.
- [ ] Quota-Verbrauch dokumentiert und im Normalbetrieb deutlich unter dem Tageslimit.
- [ ] `npm run check` grün; neue Route in OpenAPI dokumentiert.
