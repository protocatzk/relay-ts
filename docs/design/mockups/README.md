# RELAY · Design-Mockups

Vier Dashboard-Richtungen, zwei Slate-Mocks und ein Generator-Mock, alle mit
derselben Informationsarchitektur. Grundlage ist die Farbwelt des Logos
(`#DFFF4F` → `#4CE07F` → `#26E3FF` → `#B05CFF` auf `#080C12`).

| Datei | Richtung | Kernidee |
| --- | --- | --- |
| `a-neon-arcade.html` | **Neon-Arcade / Y2K (gesetzt)** | Gradient-Kanten, harte Offset-Schatten, Mono-Labels, Glow nur für Live-Zustände |
| `b-70s-print-pop.html` | 70s Print-Pop | Papier und Tinte, Sticker, Sonnenstrahlen, warme Sekundärfarben |
| `c-90s-web.html` | 90s Web / Bevel | Fenster-Chrome, 3D-Buttons, Statusleiste, klare Panel-Hierarchie |
| `d-neon-chrome.html` | Neon-Chrome (A × C, verworfen) | Mix aus A und C; nur noch als Archiv |
| `e-pause-screens.html` | Pausen-/Startbildschirme | Slates in 16:9 und 9:16, Sicherheitsraster, Text-Tokens |
| `f-slate-generator.html` | Slate-Generator | Vorschau, Presets, Inhaltsfelder, Assets, Validierung |

`a-neon-arcade.html` ist gesetzt und die Grundlage für den Designguide.
`d-neon-chrome.html` (Mix A × C) ist verworfen und bleibt nur als Archiv.
Die Guides liegen unter
[`docs/DESIGN.md`](../../DESIGN.md),
[`docs/design/PAUSE-SCREENS.md`](../PAUSE-SCREENS.md) und
[`docs/design/SLATE-GENERATORS.md`](../SLATE-GENERATORS.md).

## Ansehen

```bash
xdg-open docs/design/mockups/index.html
```

`index.html` zeigt alle Richtungen und Slates; jeder Mock lässt sich als
`file://`-Seite direkt öffnen. `screens/` enthält statische 1440×1000-PNGs
für schnelle Reviews.

Die Mocks sind statische HTML-Dateien ohne Build-Schritt. Sie sind eine
Entscheidungsgrundlage, keine Produktionsoberfläche.

## Schriften

- `Inter` und `JetBrains Mono`: bereits im Projekt gebündelt (OFL).
- `Bricolage Grotesque` und `Space Grotesk`: nur für die Mocks, OFL 1.1,
  Quellen:
  - https://fonts.google.com/specimen/Bricolage+Grotesque
  - https://fonts.google.com/specimen/Space+Grotesk
