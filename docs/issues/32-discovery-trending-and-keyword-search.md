## Ziel

Den Discovery-Trending-Feed zuverlässig machen und die Suche so erweitern, dass neben direkten Benutzer-Handles auch Freitext- und Schlagwortbegriffe („Gaming“, „Musik“, Themen) relevante Live-Streamer auffindbar machen bzw. transparente Ausweich-Ergebnisse liefern.

## Hintergrund & Ursache

- **Trending-Anzeige liefert 0 Ergebnisse / ist verbuggt:**
  - `LivePageProvider` parsed HTML von `https://www.tiktok.com/live`. Moderne TikTok-Webseiten liefern im Initial-HTML jedoch keine Live-Räume mehr im SSR-Scope.
  - `RoomInfoProvider` rief `https://www.tiktok.com/api-live/user/room/` ohne die zwingend erforderlichen Parameter `sourceType=54` und den referierenden Header auf (`params_error`).
  - `SearchProvider` fragte `https://www.tiktok.com/api/live/search/?aid=1988&keyword=...` an, was von TikTok mit `status_msg: "url doesn't match"` abgewiesen wird.
- **Suche nach einzelnen Begriffen schlägt fehl:**
  - Ein Begriff wie „gaming“ wird als Handle interpretiert, sucht nach `@gaming` (offline/nicht existent) und liefert 0 Treffer.
  - Die Suche nach mehreren Begriffen oder allgemeinen Schlagwörtern erreicht den fehlerhaften `SearchProvider` und liefert ebenfalls leere Listen.

## Lösungsschritte

1. **`RoomInfoProvider` reparieren:**
   - Parameter `sourceType=54` und korrekten Referer `https://www.tiktok.com/@${handle}/live` einbinden (identisch zur bewährten Implementierung in `resolver.ts`).
2. **Trending-Strategie & Fallbacks stabilisieren:**
   - Aktive Creator über Seed-Listen/Themen abfragen oder bei Ausfall des öffentlichen Feeds bekannte konfigurierte Streamer prüfen, damit die Ansicht nicht leer bleibt.
   - Falls Provider offline oder blockiert sind, aussagekräftige Hinweise in der Response zurückgeben.
3. **Freitext- und Begriffssuche ausbauen:**
   - Klare Trennung: Handelt es sich um ein spezifisches Handle (`@...` oder Handle-Regex) -> direkter Raum-Check.
   - Handelt es sich um ein Freitext-Schlagwort -> Suche über verfügbare Seed-Kategorien, Tag-/Bio-/Titel-Matching gecachter Räume sowie korrekte Web-Parameter.
4. **Dashboard-Feedback (`DiscoveryView.vue`):**
   - Transparente Badges & Hinweistexte bei Provider-Ausfällen (z. B. Rate-Limit oder TikTok-Schutzmaßnahmen).
   - Filter- und Sortieroptionen (z. B. Sortierung nach Zuschauern, Filter nur Live).

## Akzeptanzkriterien

- [ ] `GET /api/discovery/trending` liefert reproduzierbar echte Live-Räume oder einen transparenten Fallback-Feed.
- [ ] Freitext-Suche nach Begriffen liefert passende Ergebnisse oder durchsucht aktive/gecachte Streams verlässlich.
- [ ] Handle-Suche (`@handle`) führt einen gezielten Raum-Check mit `sourceType=54` durch.
- [ ] Dashboard zeigt im Fehlerfall klare Handlungsanweisungen statt leerer/abbrechender Ansichten.
- [ ] Tests und CI sind grün (`npm run check`).
