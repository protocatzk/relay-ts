# Cockpit-Mocks (Issue #88)

Entwurfsstände zum Dashboard-Redesign. Gerendert mit `@napi-rs/canvas` (Skia,
kein ffmpeg, keine externen Binaries); Schriften Inter und JetBrains Mono aus
`src/web/public/fonts`.

| Datei | Inhalt |
|---|---|
| `00-widgets.png` | Widget- und Typo-Blatt (Buttons, Badges, Donuts, Sparklines, Stage) |
| `10-variant-a-sticky.png` | Variante A · Sticky Cockpit — Status-Header bleibt oben, Action-Strip |
| `11-variant-b-split.png` | Variante B · Split Cockpit — Vorschau dominiert, Status als Scrim |
| `12-variant-c-compact.png` | **Variante C · Kompakt (gewählt)** — eine Action-Zeile, drei Spalten |
| `13-variant-d-mobile.png` | Variante D · Mobile — Cockpit, Swipe-Queue, Zapper, Bottom-Nav mit Signaling-Dot |
| `14-light-und-basics.png` | Light-Theme-Probe und Basis-Komponenten (Phase A) |
| `15-interaktionen.png` | Optimistic UI inkl. Rollback, Prä-Fetch, Command Palette, Tastatur |

## Designrichtung

- Elevation statt reiner Rahmenhierarchie (drei Flächen-Ebenen).
- Radius 12 px (Karten) / 8 px (Controls) / 999 px (Chips).
- Cyan (`--accent`) bleibt Interaktionsakzent; semantische Farben für
  live/ok/warn/danger.
- JetBrains Mono nur für Zahlen, IDs und Timestamps — Labels in Inter.

## Regenerieren

Die Renderer-Quellen liegen nicht im Repository (einmalige Entwurfshilfe).
Die Bilder sind Referenz für die Umsetzung in 0.32.0; Abweichungen im Code
gegenüber den Mocks sind zulässig, wenn sie der Designrichtung folgen.
