## Ziel

Ein optionales, ressourcenschonendes alternatives Layout-Modell bereitstellen: Die Stream-Statistiken und Einnahmen werden in einem flachen **Top-Banner** gebündelt, während der Chat als schlanker **Monitor auf der linken Seite** (in der ungenutzten Säule/Pillarbox bei 16:9-Streams mit 9:16-Quelle) dargestellt wird. Das Feature dient als **zweite Wahl zum bewährten Standard-Layout** und erzeugt minimalen CPU- und Rendering-Overhead.

## Hintergrund

- Aktuell werden Chat, Einnahmen und Statistiken frei auf dem Bild platziert oder als vertikales Seiten-Panel gerendert.
- Bei 16:9-Streams mit zentrierter 9:16-Live-Quelle entstehen links und rechts schwarze Balken (Pillarbox). Gleichzeitig verdecken frei platzierte Overlays im Zentrum oft Bildinhalte.
- Ein alternatives Layout-Modell löst dies elegant und trennt Zahlen von Text:
  1. **Top-Banner oben:** Zeigt Status (Live, Streamer, Uptime, Zuschauer, Likes) und Einnahmen/Spenden-Zielbalken horizontal am oberen Rand.
  2. **Chat-Monitor links:** Nutzt die sonst tote linke Säule für einen aufgeräumten, vertikalen Chat-Verlauf, ohne auch nur einen Pixel des eigentlichen Videos zu verdecken.
- **Prinzip der zweiten Wahl:** Das bestehende Layout bleibt unangetastet der Standard (Default). Der Monitor-/Banner-Modus ist optional zuschaltbar (`layout_mode: 'standard' | 'pillar_monitor'`).
- **Minimaler Overhead:** Kein neuer ffmpeg-Prozess, keine zusätzliche Video-Pipe. Alles läuft über den existierenden Canvas-Stream (fd 3) mit differenziellem Caching (Neuzeichnen nur bei neuen Nachrichten oder Sekundentakt).

## Mockup

![Top-Banner & Chat-Monitor Mockup](https://raw.githubusercontent.com/protocatzk/relay-ts/main/docs/screenshots/top-banner-overlay-mock.svg)

*Abbildung: Kopfzeile oben für Stats & Spendenziel, Chat-Monitor links in der freien Säule. Der 9:16-Live-Stream bleibt im Zentrum zu 100 % unverdeckt.*

## Umfang

- **Canvas-Rendering (`src/core/overlays/chat-engine.ts`, `overlay-manager.ts`):**
  - Optionaler Layout-Modus `pillar_monitor` im Overlay-Manager.
  - *Top-Banner (Höhe ~56 px):*
    - Links: Live-Badge, Streamer-Handle, Viewer-Counter, Likes und Uptime.
    - Rechts: Einnahmen (Coins/EUR) und kompakter Zielbalken (`goal_amount`).
  - *Chat-Monitor (links, x=16, Breite ~380–410 px):*
    - Vertikaler Chat-Stack mit Zeitstempeln, Rollen-Badges (Sub/Mod/VIP), farbigen Usernamen und weichem Nachrichten-Fade.
  - *Minimaler Overhead / Zero-Cost:*
    - Statischer Hintergrund und Rahmen werden einmalig im Canvas gerendert.
    - Chat-Bereich wird nur bei neuen SSE-Chatnachrichten aktualisiert; Zahlen nur im Sekundentakt.
    - Bleibt bei deaktiviertem Modus komplett inaktiv (0 Mehrverbrauch).
- **Overlay-Studio & Einstellungen (`src/web/src/views/OverlaysView.vue`):**
  - Umschalter für das Layout-Modell: `Standard (frei positionierbar)` vs. `Säulen-Monitor (Top-Banner + Chat links)`.
  - Vorschau im Studio (`POST /api/overlays/studio.png`) schaltet nahtlos zwischen beiden Ansichten um.
  - Optionale Schalter für sichtbare Segmente (z. B. "Zielbalken im Banner anzeigen", "Chat-Monitor links aktivieren").

## Akzeptanzkriterien

- [ ] Standard-Layout bleibt Default; Säulen-Monitor ist als alternative Option wählbar.
- [ ] Top-Banner oben und Chat-Monitor links nutzen die Pillarbox-Flächen aus, ohne den 9:16-Hauptstream zu überdecken.
- [ ] Rendering läuft vollständig über die bestehende Canvas-Pipe (fd 3) ohne messbaren CPU-Zusatzverbrauch.
- [ ] Pixelgetreue Studio-Vorschau und Umschaltung im Dashboard.
- [ ] `npm run check` grün; Unit-Tests in `tests/chat-engine.test.ts`.
