## Ziel

Die Render-Kosten des Canvas-Chat-Overlays senken, indem Neu-Renderings nur bei tatsächlichen Änderungen angestoßen werden und das Frame-Abgreifen aus dem Canvas den betroffenen Bereich statt des gesamten Panels kopiert.

## Hintergrund

- `ChatOverlayEngine.setMessages()` setzt in jedem Aufruf pauschal `dirty = true` (`src/core/overlays/chat-engine.ts:319`), auch wenn sich an der Nachrichtenliste nichts geändert hat. Jeder `dirty`-Aufruf bedeutet ein Full-Panel-Neu-Render plus `getImageData()`-Kopie.
- `renderFrame()` kopiert per `getImageData(0, 0, width, height)` das komplette Panel als RGBA-Buffer. Beim Standard-Streaming-Layout (720×1280) sind das rund 3,7 MB pro Neu-Render – bei Slide-/Fade-Animationen mehrmals pro Sekunde.
- `ChatAnalytics.prune()` (`src/core/overlays/chat-analytics.ts`) erzeugt bei jedem `record()`-Aufruf (also jedem Chat-Poll) per `filter()` ein komplett neues Array, obwohl die Events zeitlich sortiert sind und ein Head-Index wie im DelayBuffer reichen würde.
- Die Seite-Server-Analytics-`snapshot()`-Berechnung (Top-Chatter/Top-Badges) wird bei jedem Abruf über alle Events neu aufgebaut; bei starkem Chat ist das pro Dashbaord-Poll relevant.

## Umfang

- **ChatOverlayEngine (`src/core/overlays/chat-engine.ts`):**
  - `setMessages()` nur dann `dirty` setzen, wenn sich die sichtbare Liste tatsächlich geändert hat (z. B. Vergleich über Länge + IDs; O(n) mit kleinem n ist ausreichend).
  - Frame-Extraktion möglichst auf den geänderten Bereich beschränken (Dirty-Rect) oder mindestens die Animation-Fenster (Slide) von den statischen Phasen trennen, sodass im statischen Zustand kein Full-Panel-Kopieren stattfindet.
- **ChatAnalytics (`src/core/overlays/chat-analytics.ts`):**
  - `prune()` über Head-Index statt `filter()`-Neuallokation.
  - Optional: Top-Chatter/-Badges inkrementell pflegen, damit `snapshot()` nicht bei jedem Abruf das ganze Fenster re-aggregiert.

## Akzeptanzkriterien

- [ ] `setMessages()` mit unveränderter Liste triggert kein Neu-Render nachweisbar (Unit-Test).
- [ ] Statische Chat-Phasen erzeugen keine Full-Panel-`getImageData()`-Kopien pro Tick.
- [ ] Overlay-Ausgabe (Pixel-Output) bleibt visuell identisch; bestehende Chat-Engine-Tests bleiben grün.
- [ ] `npm run check` grün.
