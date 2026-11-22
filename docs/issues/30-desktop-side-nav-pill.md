## Ziel

Die Hauptnavigation (`AppBottomNav.vue`) am Desktop von der fixierten unteren Bildschirmmitte an die Seite verlegen: Statt als horizontale Pille am Boden schwebt die Navigation auf dem Desktop als schlanke, vertikale Nav-Pille am linken Bildschirmrand (optional umschaltbar auf rechts). Auf Mobilgeräten (`<= 720px`) bleibt die Navigation unverändert als feste Bottom-Tab-Leiste bestehen.

## Hintergrund

- Aktuell ist die Hauptnavigation am Desktop als horizontale Pille am unteren Rand zentriert (`bottom: 14px; left: 50%; transform: translateX(-50%)`).
- Auf typischen Desktop- und Widescreen-Monitoren (16:9, Ultrawide) verdeckt die Pille am Boden regelmäßig Aktionen im unteren Bildbereich, wie z. B. die Regie-Queue-Buttons, Log-Tabellen-Enden oder Aktionsleisten, und verkleinert die vertikale Nutzhöhe des Dashboards.
- Widescreen-Monitore bieten horizontal viel ungenutzte Fläche. Eine vertikale Seiten-Pille am linken (oder rechten) Rand nutzt diesen Raum ideal aus, hält das Dashboard vertikal vollkommen frei und fügt sich nahtlos in moderne Web-App-Layouts ein.

## Visuelles Konzept

- **Desktop (`> 720px`):**
  - **Position:** Fixiert an der linken Seite (`left: 16px; top: 50%; transform: translateY(-50%)`).
  - **Layout:** Vertikale Pille (`flex-direction: column; gap: 4px; padding: 6px`).
  - **Styling:** Glassmorphism-Look mit `var(--glass-bg-strong)`, dezentem Blur, 1px-Rahmen und Tooltips oder kompakten Labels.
  - **Content-Offset:** Das Hauptinhalts-Layout (`<main class="page-body">`) nutzt am Desktop `padding-left: 80px` (statt `padding-bottom: 84px`), sodass keine Inhalte von der Pille überdeckt werden.
  - **Optionale Platzierung:** Benutzer-Einstellung (gespeichert in `localStorage: relay_nav_position`) zur Wahl zwischen linker und rechter Seite.
- **Mobile (`<= 720px`):**
  - Unverändert als 4-Tab-Leiste am unteren Bildschirmrand inklusive `safe-area-inset-bottom`.

## Umfang & Umsetzung

- **CSS & Layout (`src/web/src/styles/layout.css`):**
  - Desktop-Klasse `.bottom-nav` / `.side-nav` für vertikale Ausrichtung am linken Rand definieren.
  - Media-Queries so ausrichten, dass Mobile-Bottom-Nav und Desktop-Side-Pill sauber getrennt sind.
- **Komponente (`src/web/src/components/AppBottomNav.vue`):**
  - Umbenennung oder Abstraktion in `AppNavPill.vue` (oder Kompatibilitäts-Wrapper).
  - ARIA-Tastaturnavigation anpassen: Pfeiltasten `ArrowUp`/`ArrowDown` für vertikale Navigation am Desktop, `ArrowLeft`/`ArrowRight` auf Mobile.
- **Benutzereinstellung:**
  - Optionale Schnellwahl für Links- / Rechts-Bündigkeit in den Dashboard-Präferenzen (`SettingsView.vue` oder Header-Menü).

## Akzeptanzkriterien

- [ ] Auf Desktop-Bildschirmen schwebt die Nav-Pille vertikal an der Seite (Standard links).
- [ ] Vertikale Bildschirminhalte (Queue, Logs, Tabellen, Player) werden unten nicht mehr von der Pille verdeckt.
- [ ] Mobilgeräte (`<= 720px`) behalten die horizontale Tab-Leiste am unteren Rand bei.
- [ ] Tastaturnavigation (`Tab`, Pfeiltasten) funktioniert barrierefrei und intuitiv.
- [ ] `npm run check` und `npm run build` laufen fehlerfrei durch.
