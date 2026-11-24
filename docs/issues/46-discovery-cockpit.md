# Discovery: Handlichkeit und Einbau ins Cockpit

## Ziel

Discovery aus dem eigenen Tab in den Regie-Alltag holen: neue Streamer finden,
vorhören und übernehmen, **ohne die Cockpit-Seite zu verlassen**. Gleichzeitig
Liste und Zapper so bedienbar machen, dass sie im Live-Betrieb taugen
(Tastatur, Vorladen, klare Zustände, Mobil-Gesten).

## Ausgangslage (geprüft an 0.33.0)

- Discovery ist seit 0.33.0 ein Untertab von **Live** (`/discovery`), aber das
  Cockpit hat **keinen Einstieg**: keine Suche, keine Aktion, kein Panel.
  `CockpitActions.vue` kennt nur Stream-, Screen- und Queue-Aktionen.
- `src/web/src/views/DiscoveryView.vue` (~880 Zeilen) bündelt Suche, Trending,
  Following, Grid und Zapper in einer Ansicht.
- Zapper (`DiscoveryZapperPlayer.vue`): Tastatur nur `↑`/`↓`, `M` (Ton),
  `Esc`. Kein Vorladen des nächsten Streams, kein Zeit-/Quellenhinweis,
  kein „Weiterzappen"-Hinweis bei Fehlern.
- Command Palette kennt Discovery nur als statischen Eintrag
  (`act-discovery-zapper` → Routenwechsel).
- API vorhanden: `/api/discovery/{trending,search,following,room,add,queue,switch,preview}`.
  **Kein** Suggest-Endpunkt, **kein** Batch-Live-Status.
  `preview` antwortet mit `404`, wenn der Stream offline ist.
- Ladezustände: Spinner statt Skeletons; Provider-Fehler nur als Pills mit
  `title` (auf Touch nicht lesbar).
- Filter: nur „nur live" und Region — keine Sortierung, keine Mindestzuschauer,
  keine Trefferzahl; Modus/Region/Suche werden nicht gemerkt.

## Umfang

### Phase A · Einstieg aus dem Cockpit

- **Header-Suche:** Suchfeld in `AppHeader.vue`, das Treffer als Overlay zeigt
  (max. 6, Tastatur wählbar, `Enter` → Zapper, `↵` auf Eintrag → Aktion).
  Debounce 250 ms, Ergebnis über neuen Suggest-Endpunkt (Phase D).
- **Action-Registry:** `discovery.zapper` (öffnet den Zapper als Overlay) und
  `discovery.search` (öffnet die Palette im Discovery-Modus). Damit erscheinen
  beide automatisch in Cockpit-Zeile, Kontextmenü und Palette.
- **Cockpit-Karte „Discovery":** in der Kennzahlen-Spalte, drei live
  Trending-Treffer mit Zuschauerzahl, Avatar und Ein-Klick-Aktionen
  (Queue/Umschalten), plus „Alle" → `/discovery`. Karte versteckt sich, wenn
  alle Provider offline sind.
- **Gemeinsamer Zustand:** Panel und `/discovery` teilen `store.discovery`;
  der Deep Link bleibt unverändert.

### Phase B · Zapper-Handlichkeit

- Zapper als **Overlay über dem Cockpit** (nicht nur Vollbild-Route), Fokusfalle
  wie `ModalDialog`, `Esc`/Backdrop schließt, `destroyZapperPlayer()` beim
  Schließen (vorhanden).
- **Shortcuts:** `←`/`→` vorheriger/nächster Raum, `Space` Ton, `S` umschalten,
  `Q` in die Queue, `A` als Streamer anlegen, `F` Vollbild, `?` Hilfe-Overlay.
- **Vorladen:** die nächsten zwei Räume werden vorgeladen (nur Metadaten +
  `preview`-URL), sichtbarer Ladezustand, Fehler mit „Weiterzappen".
- **Anzeige:** Zuschauer, Region, Alter, Provider-Quelle, „aktualisiert vor Xs";
  Avatar-Fallback wie im Grid.
- **Mobil:** Swipe hoch/runter, Aktionen als Bottom-Sheet, Ton standardmäßig aus.

### Phase C · Liste und Suche

- **Filterleiste:** nur live, Region, Mindestzuschauer, Sortierung
  (Zuschauer/neu), Trefferzähler; Filter wirken clientseitig sofort.
- **Karten:** Sekundäraktionen in ein Kontextmenü, „Umschalten" bleibt sichtbar.
- **Persistenz:** letzte Suche, Modus und Region in `localStorage` (max. 8
  Suchverläufe).
- **Zustände:** Skeletons beim Erstladen, Fehlerbanner mit Retry,
  „aktualisiert vor X" mit Refresh-Button.
- **Bekannte Streamer:** Treffer, die bereits Streamer sind, zeigen ihren
  Status (aktiv/deaktiviert) statt „Speichern".

### Phase D · API

- `GET /api/discovery/suggest?q=` — Nutzer-Suggest + SEO-Feed, `limit` ≤ 8,
  300-ms-Cache, Zod-Schema, Rate-Limit.
- `GET /api/discovery/status?handles=a,b,c` — Batch-Live-Status für die
  Cockpit-Karte (max. 20 Handles, 30-s-Cache, unbekannte Handles =
  `unknown`, nie „offline").
- `GET /api/discovery/preview/:handle` optional mit `?fallback=1` → `204`
  statt `404`, damit der Zapper ohne Fehlerbild weiterzappt.
- OpenAPI ergänzen (`npm run openapi:generate`), Tests für Schemas und Caching.

## Akzeptanzkriterien

- [ ] Aus dem Cockpit sind Suche, Zapper, Queue und Umschalten ohne
      Seitenwechsel erreichbar.
- [ ] Zapper-Shortcuts sind im Hilfe-Overlay dokumentiert und als reine
      Tastatur-Handler-Funktion getestet.
- [ ] Grid zeigt Trefferzahl, Filter wirken ohne Refetch, Modus/Region/Suche
      überleben einen Reload.
- [ ] Suggest liefert ≤ 8 Treffer aus dem Cache; Batch-Status akzeptiert ≤ 20
      Handles und cacht 30 s.
- [ ] Zapper-Fehler (Stream endet) zeigt eine klare Aktion statt eines
      eingefrorenen Bildes.
- [ ] `npm run check`, `npm run build`, `npm run test:e2e` grün; neues E2E:
      Cockpit-Suche → Zapper → Queue.
- [ ] `AGENTS.md` (Discovery-Abschnitt) und `docs/ROADMAP.md` aktualisiert.

## Abgrenzungen

- Keine Änderung an Provider-Kette, Webcast-Parsing oder 18+-Filter.
- Kein serverseitiges Favoriten-System — „Gefolgt" bleibt TikTok-seitig.
- Stream-Deck und Overlay-Studio bleiben unberührt.
- Kein Auto-Play mit Ton: der Zapper startet stumm.

## Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Zapper-Overlay parallel zum Dashboard dekodiert Video | Nur ein Player gleichzeitig, Cleanup beim Schließen |
| Suggest erhöht TikTok-Requests | Debounce 250 ms, 300-ms-Cache, Rate-Limit |
| Cockpit-Karte koppelt Discovery an den Stream-Status | Fehler bleiben im Panel, nie als Toast-Kette |
| Vorladen kostet Bandbreite | Max. 2 Räume, Abbruch bei Overlay-Close |
