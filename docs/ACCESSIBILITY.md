# Accessibility

Stand: **2026-11-20** · geprüft mit Chromium (Playwright) bei 320 px und 1280 px.

## Tastatur und Fokus

- **Skip-Link:** Der erste Tab-Fokus liegt auf „Zum Inhalt springen“. Enter setzt
  den Fokus auf `<main id="main-content">`, ohne die Hash-Route zu wechseln.
- **Navigation:** Die Hauptnavigation ist eine Tab-Leiste unten mit vier
  Bereichen (Live, Inhalte, Studio, System). Die aktive Seite trägt
  `aria-current="page"`. Innerhalb eines Bereichs zeigt eine zweite
  Navigationsleiste die Unterseiten (`aria-label="<Bereich>: Unterseiten"`).
- **Modals:** `ModalDialog` fängt den Fokus, schließt mit `Escape` und gibt den
  Fokus an das auslösende Element zurück.
- **Sichtbare Fokuszustände:** `:focus-visible` mit 2-px-Akzentrahmen; auch
  Eingaben, Selects und Textareas behalten einen sichtbaren Fokus.
- **Overlay-Studio:** Die Bereichs-Tabs (`role="tablist"`) unterstützen Roving
  `tabindex`, `ArrowLeft`/`ArrowRight`, `Home`/`End`, verknüpfte
  `aria-controls`/`aria-labelledby`-Panels (`role="tabpanel"`) und
  Status-Ansagen für Screenreader. Das aktive Overlay ist per Tab erreichbar und
  lässt sich mit den Pfeiltasten verschieben.

## Struktur und Screenreader

- Header, Hauptnavigation (`aria-label="Hauptnavigation"`), Unterseiten-Tabs,
  `<main>` und Footer sind eindeutige Landmarks; jede Seite hat genau eine `<h1>`.
- Die Streamer-Tabelle hat ein `<caption>`, explizite Rollen
  (`table`/`row`/`columnheader`/`cell`) und `scope="col"`.
- Auf Mobile werden Tabellenzeilen zu Karten; jedes `<td>` trägt ein
  `data-label`, das als sichtbares Feldlabel erscheint.
- Statusmeldungen nutzen `role="status"`; Toasts und Fehler werden angekündigt.
- Interaktive Icons haben `aria-label`; dekorative SVGs sind `aria-hidden`.

## Kontrast (WCAG AA)

| Theme | Vordergrund | Hintergrund | Verhältnis |
|---|---|---|---|
| Dark | `#dfe6ee` Text | `#0b0e13` | 15,36:1 |
| Dark | `#8a97a8` Muted | `#0b0e13` | 6,51:1 |
| Dark | `#3fb950` Akzent | `#10151c` | 7,21:1 |
| Dark | `#7ee787` Akzenttext | `#10151c` | 11,93:1 |
| Light | `#26313c` Text | `#f2f5f8` | 12,09:1 |
| Light | `#5d6b7a` Muted | `#f2f5f8` | 4,99:1 |
| Light | `#1a7f37` Akzent | `#ffffff` | 5,08:1 |

Alle geprüften Paare erfüllen mindestens 4,5:1 für normalen Text.

## Automatisierte Prüfung

```bash
npm run build:web
npm run test:e2e        # Playwright, startet den Dev-Server selbst
```

Die Suite prüft:

- kein horizontaler Overflow auf Dashboard, Streamer, Playlists, Overlay-Studio,
  Einstellungen und Logs bei **320 px**,
- vier beschriftete Bereiche in der Hauptnavigation samt `aria-current`,
- Wechsel über die Unterseiten-Tabs (z. B. Streamer → Medien) inklusive
  aktivem Bereich,
- Landmarks, Skip-Link, Tabellen-Caption und Spaltenrollen,
- zugängliche Namen aller sichtbaren Eingaben in den Einstellungen,
- Theme-Wechsel Dark/Light ohne Overflow,
- Karten-Labels der Streamer-Tabelle auf Mobile.

CI: `.github/workflows/ci.yml` führt die E2E-Suite nach den Unit-Tests aus.

## Manuelle Restprüfung

Screenreader-Stichproben (VoiceOver/Safari, TalkBack/Chrome, NVDA/Firefox) sind
nicht automatisiert. Zu prüfen sind Navigations-Ansage, Statusmeldungen und die
Karten-Tabellen; die Struktur ist dafür mit Rollen und Labels vorbereitet.
