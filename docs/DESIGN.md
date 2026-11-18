# RELAY Designguide

Marke, Oberfläche und Sprache für RELAY. Dieser Guide ist die verbindliche
Referenz für Dashboard, Pause-/Startbildschirm, Overlays, Dokumentation und
Markenflächen.

- **Version:** 1.0 (Arbeitsstand)
- **Designrichtung:** Neon-Arcade / Y2K (Mock A)
- **Grundlage:** Logo-Farbwelt, Dashboard-Mock
  [`docs/design/mockups/a-neon-arcade.html`](./design/mockups/a-neon-arcade.html)
- **Geltung:** App (Dark + Light), Markenflächen, Doku

**Verwandte Guides**

- [Pausen- und Startbildschirme](./design/PAUSE-SCREENS.md)
- [Slate-Generatoren](./design/SLATE-GENERATORS.md)
- [Mocks und Styleguide-Galerie](./design/mockups/index.html)

## Kurzfassung

RELAY sieht aus wie ein Werkzeug aus einer freundlicheren Zukunft: dunkles
Pult, neonfarbene Signalwege, klare Karten und viel lesbare Technik. Die
Marke ist verspielt, die Oberfläche bleibt nüchtern. Verspieltheit sitzt in
Farbe, Typo und Details – nie in der Bedienlogik.

Drei Sätze, die jede Entscheidung prüfen:

1. **Ein Blick muss reichen.** Status ist immer Form + Farbe + Text, nie nur
   Farbe.
2. **Ein Signal pro Fläche.** Der Logo-Verlauf markiert entweder eine Kante
   oder eine Aktion – nicht beides in derselben Karte.
3. **Technik darf schön sein, aber nicht laut.** Mono-Labels und Leuchtkanten
   strukturieren; sie dekorieren nicht.

---

## 1 Marke

### 1.1 Charakter

| Eigenschaft | Ausdruck |
| --- | --- |
| Verspielt | Neonfarben, Verlaufslinien, kleine LED-Details, kantige Typo |
| Technisch | Mono-Daten, Einheiten, Labels, Meta-Zeilen |
| Ehrlich | Klare Zustände, keine Werbesprache, keine Emojis |
| Ruhig | Tiefschwarz als Bühne, viel Luft zwischen den Signalen |

RELAY ist kein Unterhaltungsprodukt, sondern das Mischpult hinter dem Stream.
Die Stimmung ist „Samstagabend im Regieraum", nicht „Casino".

### 1.2 Name und Wortmarke

- Schreibweise immer **RELAY**, vier Großbuchstaben, kein Punkt, keine
  Übersetzung.
- Wortmarke: Space Grotesk 700, Laufweite `0.2em`, optional mit
  „restreamer" in Mono 8,5–9 px, Laufweite `0.26em`, Großbuchstaben.
- Die Wortmarke tritt nie ohne Freiraum auf; sie wird nicht gesperrt,
  skaliert oder mit Effekten versehen.

### 1.3 Tonalität in drei Worten

**Direkt. Wach. Unaufgeregt.**

---

## 2 Logo

Das Logo besteht aus zwei gestaffelten Play-Flächen: einer halbtransparenten
„Echo"-Fläche und der vollen Fläche im Markenverlauf, auf einem dunklen,
abgerundeten Quadrat.

### 2.1 Aufbau

| Element | Wert |
| --- | --- |
| Trägerfläche | `#080C12`, Radius ca. 22,6 % der Kantenlänge |
| Verlauf | `#DFFF4F` → `#4CE07F` (34 %) → `#26E3FF` (68 %) → `#B05CFF` |
| Echo-Fläche | Verlauf Lime → Cyan, Deckkraft 55 %, um −7° gedreht |
| Innenlicht | Weiß, Deckkraft 12 % |
| Rand | Weiß, Deckkraft 9 %, 3/512 der Kantenlänge |

### 2.2 Schutzraum und Größe

- Schutzraum an allen Seiten: **25 % der Logo-Höhe** (mindestens die Höhe des
  kleinen Echo-Dreiecks).
- Digital: Mindestgröße **24 px** für das Icon, **96 px** für die
  Präsentationsfläche. Darunter nur das Icon ohne Trägerquadrat.
- Print: Mindestbreite **10 mm**.
- Favicon/App-Icon: Trägerquadrat mit 22,6 % Radius, keine zusätzliche
  Umrandung.

### 2.3 Hintergründe

Erlaubt:

- `#080C12` und die dunklen Flächen `#07090F` / `#0B1017`
- einfarbige Markenfarben mit ausreichendem Kontrast (Lime, Mint, Cyan,
  Violett) – dann Trägerquadrat beibehalten
- Foto/Video nur mit dunkler, ruhiger Zone und mindestens 40 % Abdunklung

Nicht erlaubt:

- Mittelgrau oder unruhige Verläufe hinter dem Icon
- Logo auf dem Markenverlauf ohne Trägerquadrat
- Schlagschatten, Outline, eingebackener Glow oder Rotation im Logo-Asset
- Neu einfärben, Verlauf umkehren, Echo-Fläche entfernen
- In der App darf die Sidebar-Marke einen weichen CSS-Glow tragen; das Asset
  selbst bleibt unverändert

### 2.4 Markenverlauf als Signal

Der Verlauf ist kein Hintergrund, sondern ein **Signal für Bewegung und
Live-Zustand**. Erlaubte Einsätze:

- 2-px-Oberkante einer Karte
- Primärbutton
- Live-Badge und aktiver Sende-Namen
- eine Fortschritts-/Pegelanzeige

Nicht erlaubt: Verlaufstext für Fließtext, Verlauf als Kartenfüllung,
mehrere konkurrierende Verläufe im selben Sichtfeld.

---

## 3 Farbe

### 3.1 Markenspektrum

| Name | Hex | Rolle |
| --- | --- | --- |
| Signal Lime | `#DFFF4F` | Live, Primärsignal, Fokus |
| Mint | `#4CE07F` | Erfolg, Quelle stabil |
| Cyan | `#26E3FF` | Information, Relay, Links |
| Violett | `#B05CFF` | Einnahmen, Overlays, Sonderstatus |
| Tinte | `#080C12` | Markenfläche, tiefster Hintergrund |

### 3.2 Dark Theme (Standard)

| Token | Hex | Verwendung |
| --- | --- | --- |
| `--bg` | `#07090F` | Seitenhintergrund |
| `--bg-soft` | `#0A0F17` | Sekundärflächen, Toolbars |
| `--surface` | `#0B1017` | Karten |
| `--surface-2` | `#0E1621` | erhöhte Flächen, Hover |
| `--well` | `#070C13` | dunkle Datenfelder, flach |
| `--line` | `#222A3D` | Standardrahmen |
| `--line-strong` | `#39425F` | betonte Rahmen, Controls |
| `--line-dark` | `#04060A` | Schattenfuge, sehr dunkle Kante |
| `--text` | `#EAF2FF` | Primärtext |
| `--text-muted` | `#8D9AB4` | Sekundärtext (6,7:1) |
| `--text-dim` | `#7C89A3` | Meta, Einheiten (5,4:1) |
| `--live` | `#DFFF4F` | Live/Signal (16,9:1) |
| `--success` | `#4CE07F` | Erfolg (11,2:1) |
| `--info` | `#26E3FF` | Information (12,3:1) |
| `--warning` | `#F2C94C` | Warnung (12,0:1) |
| `--danger` | `#FF6B5E` | Fehler, Stop (6,8:1) |
| `--special` | `#B05CFF` | Einnahmen/Overlay (5,3:1) |

### 3.3 Light Theme („Papier")

Die helle Variante ist Papier, kein Weiß. Sie übernimmt die Wärme aus
Richtung B, bleibt aber im Neon-Arcade-Raster.

| Token | Hex | Verwendung |
| --- | --- | --- |
| `--bg` | `#F4EAD8` | Papierhintergrund |
| `--bg-soft` | `#EFE3CE` | Sekundärflächen |
| `--surface` | `#FFF9EC` | Karten |
| `--surface-2` | `#F9EFDD` | Hover, erhöhte Flächen |
| `--well` | `#F0E3CC` | Datenfelder, flach |
| `--line` | `#D6C6A9` | dekorative Rahmen |
| `--line-strong` | `#1D1913` | betonte Rahmen |
| `--text` | `#1D1913` | Primärtext (14,7:1) |
| `--text-muted` | `#5E5546` | Sekundärtext (7,0:1) |
| `--text-dim` | `#6B6052` | Meta (5,2:1) |
| `--live` | `#D7E84E` | nur als Fläche mit Tinte (12,9:1) |
| `--live-text` | `#55701A` | Lime als Text/Link (5,4:1) |
| `--success` | `#2F7A4F` | Erfolg (5,0:1) |
| `--info` | `#0E7C8C` | Information (4,7:1) |
| `--warning` | `#8A5A00` | Warnung (5,7:1) |
| `--danger` | `#B23A1F` | Fehler (5,7:1) |
| `--special` | `#7B4FA8` | Einnahmen (5,7:1) |

**Wichtig:** Lime ist auf Papier eine Flächenfarbe, keine Textfarbe. Für
Links und interaktive Beschriftung `--live-text` verwenden.

### 3.4 Farbregeln

- Semantische Farben nur für ihren Zustand. Cyan ist kein Deko-Akzent.
- Status immer **Punkt/LED + Text**. Farbe allein reicht nie.
- Maximal zwei Signalfarben pro Karte; Violett und Lime nie nebeneinander
  als gleichrangige Flächen.
- Große Flächen bleiben neutral. Farbe sitzt in Kanten, Punkten, Zahlen und
  einem primären Element.
- Kontrast: Text ≥ 4,5:1, große Zahlen ≥ 3:1, dekorative Linien ohne
  Textanspruch dürfen darunter liegen.

---

## 4 Typografie

### 4.1 Schriften

| Rolle | Schrift | Schnitte | Einsatz |
| --- | --- | --- | --- |
| Display | **Space Grotesk** | 600, 700 | Seitentitel, Sende-Name, große Zahlen, Wortmarke |
| UI | **Inter** | 400, 500, 600, 700 | Fließtext, Formulare, Tabellen, Buttons |
| Daten | **JetBrains Mono** | 400, 600 | Labels, Einheiten, Zeitstempel, IDs |

Alle drei sind lokal zu bündeln (OFL). Fallback: System-Sans bzw.
`ui-monospace`.

### 4.2 Skala

| Token | Größe / Zeilenhöhe | Schrift | Einsatz |
| --- | --- | --- | --- |
| `display-xl` | 34 / 1.05 | Space Grotesk 700 | Sende-Name im Hero |
| `display-l` | 28 / 1.1 | Space Grotesk 700 | Seitentitel |
| `title` | 18 / 1.25 | Space Grotesk 600 | Karten- und Dialogtitel |
| `body` | 13.5 / 1.5 | Inter 400 | Standardtext |
| `body-sm` | 12 / 1.45 | Inter 400 | Meta, Hilfetexte |
| `label` | 10 / 1.2 | Mono 600 | Großbuchstaben, Laufweite `.14em` |
| `data` | 13 / 1.2 | Mono 400 | Werte, IDs, Zeit |
| `data-lg` | 21–24 / 1 | Space Grotesk 600 | Kennzahlen |

Regeln:

- Nie mehr als drei Schriftgrößen pro Karte.
- Labels sind **mindestens 10 px**; 8,5 px aus frühen Mocks sind nicht
  produktionsfähig.
- Fließtext max. 68 Zeichen pro Zeile.
- Zahlen mit `font-variant-numeric: tabular-nums`, Einheiten eine Stufe
  kleiner und in `--text-dim`.
- Keine Großbuchstaben für Sätze, nur für Labels und Meta-Zeilen.
- Laufweite: Display `-0.03em`, UI `0`, Label `+0.14em`, Wortmarke `+0.2em`.

### 4.3 Labels und Meta-Zeilen

Labels sind ein Markenelement: Mono 10 px, Laufweite `.2em` (Feldlabels
`.14em`), Großbuchstaben,
davor ein 7-px-Quadrat in Lime. Sie benennen den Bereich („Streamer",
„Playlist · Nightshift"), nicht eine Aktion. Rechts in derselben Zeile steht
optional ein Meta-Link in Mono 9 px („Alle anzeigen") – kein Knopf,
kein Pfad, keine Pseudo-URL.

---

## 5 Raster und Layout

### 5.1 Grundraster

- Basis: **4 px**. Erlaubte Abstände: 4, 6, 8, 11, 14, 18, 24, 32, 44.
- Seitenrand: 24 px Desktop, 16 px Tablet, 14 px Mobile.
- Inhalt max. **1240 px**, zentriert.
- Sidebar 238 px, Header 56 px, Footer 20 px.
- Kartenabstand 11 px (dichte Ansichten) oder 14 px (Formulare).
- Kartenpolster 14 px; Formulargruppen 18–24 px.

### 5.2 Breakpoints

| Bereich | Verhalten |
| --- | --- |
| ≥ 1100 px | volle Sidebar, 5er-Metrikleiste |
| 900–1099 px | Sidebar bleibt, Inhalte rücken enger |
| 700–899 px | Sidebar wird Drawer, Metriken 2–3 Spalten |
| 520–699 px | Karten einspaltig, Tabellen werden Karten |
| < 520 px | Meta-Zeile kürzt, Buttons full width |

### 5.3 Prioritäten pro Screen

1. Zustand (Live/Offline/Pause) und Quelle
2. eine primäre Aktion
3. Kennzahlen
4. Details und Historie

Der Hero ist kein Marketingbereich. Er beantwortet in drei Sekunden:
**Was läuft, woher, wohin, seit wann?**

---

## 6 Flächen und Tiefe

### 6.1 Drei Ebenen

| Ebene | Fläche | Kante | Schatten |
| --- | --- | --- | --- |
| Hintergrund | `--bg` | – | – |
| Karte | `--surface` | 1 px `--line`, 2 px Verlauf oben | 4 px harter Offset |
| Datenfeld | `--well` | 1 px `--line` | keiner |

### 6.2 Leuchtkante

Die Signatur ist eine 2-px-Linie im Markenverlauf an der Oberkante einer
Karte – einmal pro Karte, nie als Rahmen um alle Seiten.

```css
.card {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.45);
}
.card::before {
  content: '';
  position: absolute;
  inset: -1px -1px auto;
  height: 2px;
  background: var(--brand-gradient);
  border-radius: 6px 6px 0 0;
}
```

- Die Leuchtkante markiert den oberen Rand, nicht den Fokus.
- Buttons und Felder bleiben flach: 1 px Rahmen, keine Innenkante.
- Keine Verläufe als Kartenfläche; der Primärbutton ist die Ausnahme.
- Keine Glows auf Karten.
- Datenfelder tragen Werte (Kennzahlen, Status, Zeit), keine Prosa.

### 6.3 Radien

| Element | Radius |
| --- | --- |
| Button, Feld | 4 px |
| Badge, Chip | 3 px |
| Karte | 6 px |
| Modal, Sheet | 8 px |
| Pille/Chip, Punkt | 999 px |
| Avatar | 6 px (eckig) oder Kreis für Personen |

Harte Kanten sind Teil der Marke. Größere Radien nur für mobile Sheets.

### 6.4 Schatten

- Karten: harter `4px 4px 0 rgba(0, 0, 0, .45)`; Buttons `3px 3px 0 #000`.
- Modals: 1 px Rahmen + weicher Schatten, Backdrop `rgba(3,6,10,.72)`.
- Glow nur bei Live, Fokus und dem Primärbutton, dort sparsam.

---

## 7 Komponenten

### 7.1 Buttons

| Variante | Fläche | Text | Einsatz |
| --- | --- | --- | --- |
| Primary | Markenverlauf | `#06090E` | genau eine Hauptaktion pro Screen |
| Secondary | `#121A26` | `--text` | Standardaktionen |
| Ghost | `--bg-soft` | `--text-muted` | tertiär, destruktive Nähe |
| Danger | `#FF6B5E` Fläche | `#1A0705` | Stop, Löschen, Trennen |

- Höhe 36 px, Padding 0 14 px, Radius 4 px, Mono 11 px, Laufweite `.09em`,
  Großbuchstaben, harter `3px 3px 0 #000`-Schatten.
- Mobile Mindesthöhe **38 px**, besser 44 px.
- Hover: Rahmen Lime bei Secondary, Helligkeit +6 % bei Primary.
- Aktiv: 1 px nach unten, Schatten auf 2 px verkürzt.
- Disabled: Deckkraft 45 %, kein Hover.
- Icon + Label: Abstand 7 px, Icon 14–16 px.

### 7.2 Formularfelder

- Höhe 34 px, Radius 4 px, Hintergrund `#0A0F17`, Rahmen `--line-strong`.
- Fokus: Rahmen Lime, Ring `0 0 0 3px rgba(223,255,79,.16)`.
- Label 10 px Mono, Großbuchstaben, `.14em`; Pflichtfeld mit `*` in
  `--danger`.
- Hilfe 12 px Inter in `--text-muted`, max. zwei Zeilen.
- Fehlertext ersetzt die Hilfe, ergänzt `aria-describedby`.
- Selects mit eigenem Chevron, nie native Optik.
- Mobile Eingaben **16 px**, sonst zoomt iOS.

### 7.3 Status und Badges

| Element | Aufbau |
| --- | --- |
| LED | 6 px Punkt, Glow nur wenn live/aktiv |
| Badge | 20 px hoch, Mono 9,5 px, Radius 3 px, 1 px Rahmen |
| Statuszeile | LED + Text + optional Detail in Mono |

Zustände:

- **Live** – Lime, gefüllt, pulsierend (2 s)
- **Verbinde…** – Cyan, ruhig
- **Pause** – Violett
- **Offline** – Grau, kein Glow
- **Fehler** – Koralle, statisch

### 7.4 Karte mit Leuchtkante

Aufbau:

1. 2 px Markenverlauf an der Oberkante
2. Kopfzeile: 7-px-Quadrat in Lime, Mono-Label, rechts optional ein Meta-Link
3. Inhalt mit 14–18 px Polster

Die Kopfzeile ist Text, keine Bedienleiste. Sie enthält keine Buttons
und keine Pseudo-Pfade. Ein Link rechts ist eine echte Aktion und braucht
`aria-label` sowie eine Trefferfläche von 24 × 24 px.

### 7.5 Kennzahlen

- Label oben (Mono 10 px), Wert (Space Grotesk 21–24 px), Kontext (Mono
  8,5–10 px), optional Pegel.
- Einheit klein und tiefgestellt wirkend, nicht fett.
- Nullwerte sind erlaubt und werden nicht ausgeblendet.
- Fehlende Werte: `—` plus Tooltip, nicht `0`.

### 7.6 Tabellen

- Kopfzeile Mono 10 px, Großbuchstaben, `.08em`, `--text-muted`.
- Zeilenhöhe 40–44 px, Trennlinien 1 px `--line`.
- Hover `rgba(223,255,79,.04)`, aktive Zeile Lime-Rahmen links.
- Zahlen rechtsbündig, tabellarisch.
- Mobile: Karten mit Label/Wert-Paaren, keine horizontale Scrollfalle.

### 7.7 Dialoge

- Max. 820 px, Radius 8 px, 1 px `--line-strong`.
- Kopf mit Titel + Schließen, Fuß mit Aktionen rechts.
- Backdrop dunkel und unscharf (4 px).
- Fokus fällt in den Dialog, `Escape` schließt, Fokus kehrt zurück.
- Keine gestapelten Dialoge.

### 7.8 Toasts

- Rechts unten, max. 360 px, Radius 3 px, 2 px semantische Kante links.
- Dauer 5 s (Fehler 8 s), pausiert bei Hover/Fokus.
- Maximal drei gleichzeitig, ältere rücken nach.

### 7.9 Footer und Meta-Zeile

- Flacher Footer am Seitenende, Mono 9 px, Großbuchstaben, `--text-dim`.
- Links Version und Domain, rechts die Design- oder Build-Kennung.
- Keine Statusdaten im Footer; die stehen im Dashboard oder in der Kopfzeile.
- Auf Mobile einzeilig, notfalls nur die Version.
- Der Footer ist keine Fehlermeldung und kein Log.

### 7.10 Navigation

- Aktiver Punkt: Lime-Text, 3-px-Lime-Kante links, getönte Fläche mit Lime-Rahmen.
- Icons 16–18 px, Strich 1,8 px, runde Enden.
- Labels 12,5 px Inter 600.
- Drawer unter 900 px mit Fokusfalle und `Escape`.

---

## 8 Bewegung

| Dauer | Einsatz |
| --- | --- |
| 120 ms | Hover, Press, Fokus |
| 180 ms | Dialog, Toast, Tabwechsel |
| 260 ms | Drawer, Seitenwechsel |

- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Nur Live-Punkte pulsieren, 2 s, weich.
- Keine Bounces, kein Parallax, keine dauerhaft laufenden Animationen im
  Betrieb.
- `prefers-reduced-motion`: alle Animationen auf 0,01 ms, Puls aus.
- Zahlen zählen nicht hoch; sie springen auf den Wert.

---

## 9 Icons

- 24 × 24 Raster, Strich 1,8 px, runde Enden und Ecken.
- Anzeige 16 px inline, 18–20 px Navigation, 22 px Empty States.
- Keine gefüllten Icons außer Status-Punkten.
- Keine Emojis in der Oberfläche.
- Icon ohne Label nur, wenn die Bedeutung etabliert ist (Schließen, Suche,
  Theme); immer mit `aria-label`.

---

## 10 Barrierefreiheit

### 10.1 Kontrast (geprüft)

| Paar | Verhältnis |
| --- | --- |
| `#EAF2FF` auf `#0B1017` | 16,9:1 |
| `#8D9AB4` auf `#0B1017` | 6,7:1 |
| `#7C89A3` auf `#0B1017` | 5,4:1 |
| `#DFFF4F` auf `#0B1017` | 16,9:1 |
| `#FF6B5E` auf `#0B1017` | 6,8:1 |
| `#1D1913` auf `#FFF9EC` | 16,7:1 |
| `#5E5546` auf `#FFF9EC` | 7,0:1 |
| `#55701A` auf `#FFF9EC` | 5,4:1 |

`#606C86` (3,6:1) ist **kein** Texttoken mehr. Es bleibt höchstens für
dekorative Linien zulässig.

### 10.2 Regeln

- Fokus: 2 px Lime, 2 px Offset, immer sichtbar – auch auf Lime-Flächen mit
  dunklem Innenring.
- Trefferflächen ≥ 38 px, mobil ≥ 44 px.
- Status nicht nur über Farbe; LED + Text + `aria-live` für Änderungen.
- Formularfehler mit Text, Icon und Feldbezug.
- Farbschema respektieren: `color-scheme: dark|light`.
- Light Theme separat prüfen; Lime niemals als Text auf Papier.
- Tabellen mit `<th scope>`, mobile Karten mit Rollen und Labels.
- Kontrast bei jedem neuen Token messen, nicht schätzen.

---

## 11 Sprache

### 11.1 Stimme

Deutsch, Du-Form, ruhig, konkret. Verben zuerst. Keine Ausrufezeichen, keine
Superlative, keine Emojis.

| Statt | Besser |
| --- | --- |
| „Fehler!" | „Sink nicht erreichbar. Neustart läuft." |
| „Stream wurde erfolgreich gestartet!" | „Stream läuft." |
| „Bitte warte einen Moment…" | „Verbinde mit TikTok…" |
| „Keine Daten vorhanden" | „Noch keine Messwerte." |

### 11.2 Vokabular

- **Quelle** (TikTok), **Sink** (YouTube), **Relay**, **Playlist**,
  **Pause**, **Startbildschirm**, **Overlay**.
- Zustände: `Live`, `Verbinde…`, `Pause`, `Offline`, `Fehler`.
- Zeit: `02:14:38`, Dauer `2,4 s`, Datum `18.11.2026`.
- Zahlen: de-DE, Komma, Leerzeichen vor Einheit (`5,82 Mbit/s`).

### 11.3 Microcopy

- Buttons benennen die Aktion: „Pause starten", „Sender wechseln".
- Bestätigungen beschreiben das Ergebnis, nicht den Klick.
- Destruktive Aktionen nennen die Folge: „Stream stoppen – Zuschauer sehen
  den Pausenscreen."

---

## 12 Markenflächen

### 12.1 Pause- und Startbildschirm

- Hintergrund: Tiefschwarz mit einer ruhigen Verlaufsblüte, keine harten
  Muster.
- Logo mittig oder links oben, mindestens 96 px, Schutzraum einhalten.
- Eine Zeile Status („Gleich geht's weiter"), optional Countdown.
- Keine Werbung, keine Social-Handles, kein QR-Code im laufenden Stream.
- Der Verlauf erscheint als 2-px-Linie oder im Logo, nicht als Fläche.

### 12.2 Overlays

- Chat: dunkle Halbtransparenz, 1 px Rand, Mono-Name, Inter-Text.
- Einnahmen: Violett als Rahmen, Zahlen in Space Grotesk, Währung klein.
- Overlays sind lesbar bei 720p und 1080p; Mindestschrift 14 px im
  Ausgabebild.
- Keine Bedienleisten, keine Meta-Zeilen in Overlays.

### 12.3 Dokumentation und Social

- Titel in Space Grotesk, Text in Inter, Code in JetBrains Mono.
- Hintergrund Tinte, Verlauf nur als dünne Linie oder Logo.
- Bildmarke: Logo auf ruhiger Fläche, Claim „Restreamer" in Mono.
- Keine dekorativen Screenshots mit fiktiven Live-Zahlen ohne
  „Beispiel"-Kennzeichnung.

---

## 13 Umsetzung

### 13.1 Dateien

Empfohlener Weg, ohne die bestehende Struktur zu sprengen:

1. `src/web/src/style.css` bleibt Basis-Layout.
2. `src/web/src/toktracker.css` wird schrittweise zum neuen Theme
   (Tokens + Komponenten), statt eine dritte Override-Schicht zu stapeln.
3. Neue Assets: `src/web/public/fonts/space-grotesk-latin-var.woff2`
   (OFL, ca. 22 kB).
4. Mocks und Guide bleiben unter `docs/design/`.

### 13.2 Token-Block (Referenz)

```css
:root,
[data-theme='dark'] {
  color-scheme: dark;

  --bg: #07090f;
  --bg-soft: #0a0f17;
  --surface: #0b1017;
  --surface-2: #0e1621;
  --well: #070c13;

  --line: #222a3d;
  --line-strong: #39425f;
  --line-dark: #04060a;

  --text: #eaf2ff;
  --text-strong: #f7fbff;
  --text-muted: #8d9ab4;
  --text-dim: #7c89a3;

  --live: #dfff4f;
  --success: #4ce07f;
  --info: #26e3ff;
  --warning: #f2c94c;
  --danger: #ff6b5e;
  --special: #b05cff;

  --brand-gradient: linear-gradient(
    100deg,
    #dfff4f 0%,
    #4ce07f 34%,
    #26e3ff 68%,
    #b05cff 100%
  );

  --radius: 4px; /* Buttons, Felder */
  --radius-sm: 3px; /* Badges */
  --radius-lg: 6px; /* Karten */
}

[data-theme='light'] {
  color-scheme: light;

  --bg: #f4ead8;
  --bg-soft: #efe3ce;
  --surface: #fff9ec;
  --surface-2: #f9efdd;
  --well: #f0e3cc;

  --line: #d6c6a9;
  --line-strong: #1d1913;
  --line-dark: #b9a582;

  --text: #1d1913;
  --text-strong: #0f0d0a;
  --text-muted: #5e5546;
  --text-dim: #6b6052;

  --live: #d7e84e;
  --live-text: #55701a;
  --success: #2f7a4f;
  --info: #0e7c8c;
  --warning: #8a5a00;
  --danger: #b23a1f;
  --special: #7b4fa8;
}
```

### 13.3 Mapping auf bestehende Tokens

| Alt (TokTracker) | Neu |
| --- | --- |
| `--accent` Grün `#3FB950` | `--live` Lime `#DFFF4F` |
| `--accent-text` | `--live` bzw. `--live-text` (Light) |
| `--border-strong` Weiß | `--line-strong` Blaugrau |
| `--surface-hover` | `--surface-2` |
| `--module-chat` Violett | `--special` |
| Radius `2px` überall | 4 px Controls, 6 px Karten |
| `--shadow: none` | harter Offset + Leuchtkante |

Der bestehende Grün-Akzent wird vollständig ersetzt. Grün bleibt nur als
semantisches „Erfolg" (Mint) erhalten.

### 13.4 Migrationsreihenfolge

1. Tokens und Fonts
2. Buttons, Felder, Fokus
3. Karten + Leuchtkanten
4. Kennzahlen und Tabellen
5. Dialoge, Toasts
6. Overlay-Studio und Login
7. Light Theme nachziehen
8. Kontrast- und E2E-Checks

Nach jedem Schritt: `npm run check`, bei UI `npm run build` und
`npm run test:e2e`.

---

## 14 Do / Don't

| Do | Don't |
| --- | --- |
| Ein Primärbutton pro Sicht | Zwei Gradient-Buttons nebeneinander |
| Verlauf als 2-px-Signal | Verlauf als Kartenhintergrund |
| Mono für Zahlen und Labels | Mono für Fließtext |
| LED + Text für Status | Nur ein farbiger Punkt |
| Mono-Label mit echtem Kontext | Dekorative Leisten ohne Funktion |
| Kleine Radien (3–6 px) | Große Radien und weiche Karten |
| Ein Akzent pro Karte | Lime, Cyan und Violett gleichzeitig |
| Light Theme als Papier | Light Theme als invertiertes Dark |

---

## 15 Review-Checkliste

- [ ] Ein Blick reicht: Zustand, Quelle, Ziel, Dauer erkennbar?
- [ ] Genau ein primäres Signal pro Karte?
- [ ] Alle Status mit Text, nicht nur Farbe?
- [ ] Labels ≥ 10 px, Fließtext ≥ 12 px?
- [ ] Kontrast geprüft, inklusive Light Theme?
- [ ] Fokus sichtbar, Tab-Reihenfolge logisch?
- [ ] Trefferflächen ≥ 38 px, mobil ≥ 44 px?
- [ ] Mobile 320 px ohne horizontalen Overflow?
- [ ] `prefers-reduced-motion` respektiert?
- [ ] Keine Emojis, keine Ausrufezeichen in der UI?
- [ ] Zahlen de-DE und tabellarisch?
- [ ] Leuchtkante maximal einmal pro Karte?
- [ ] Verlauf maximal einmal pro Sicht?
