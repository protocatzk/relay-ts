# RELAY · Styleguide Pausen- und Startbildschirme

Verbindliche Gestaltungsregeln für die Slates, die den YouTube-Sink überbrücken,
wenn keine TikTok-Quelle anliegt.

- **Version:** 1.0 (Arbeitsstand)
- **Gehört zu:** [`docs/DESIGN.md`](../DESIGN.md)
- **Mock:** [`docs/design/mockups/e-pause-screens.html`](./mockups/e-pause-screens.html)
- **Generator-Regeln:** [`docs/design/SLATE-GENERATORS.md`](./SLATE-GENERATORS.md)

## Kurzfassung

Ein Slate ist **kein Poster und keine Landingpage**. Er erklärt in drei Sekunden,
warum gerade kein Bild läuft, und hält den Kanal ruhig. Deshalb: ein Statement,
ein Untertatz, ein Signal. Alles andere ist Hintergrund.

Drei Regeln:

1. **Der Text ist der Screen.** 20 Zeichen Haupttext, 40 Zeichen Untertext.
2. **Ruhiges Bild, klare Kante.** Bewegung nur außerhalb des Textblocks, nie
   darunter.
3. **Kein Versprechen, das RELAY nicht halten kann.** Keine erfundenen
   Uhrzeiten, keine Countdowns ohne echte Quelle.

---

## 1 Rolle und Zustände

| Zustand | Screen | Auslöser | Dauer | Was der Zuschauer sieht |
| --- | --- | --- | --- | --- |
| Automatische Pause | Pausenscreen | Quelle weg, Grace abgelaufen | bis Quelle zurück oder `pause.max_minutes` | „Wir sind gleich zurück." |
| Manuelle Pause | Pausenscreen | Dashboard/API/Bot | unbegrenzt, bis Stop | derselbe Screen, ohne Zeitzwang |
| Startbildschirm | Startscreen | Start aus dem Idle-Zustand | `startup.duration_seconds` (Default 10 s) | „Gleich geht's los." |
| Idle | keiner | kein Sink aktiv | – | schwarzer Kanal |

Wichtig für die Gestaltung:

- Der Sink und die RTMP-Verbindung bleiben bestehen. Der Slate ist ein
  Quellenwechsel am Relay, kein neuer Stream.
- Automatische Pausen enden von selbst; manuelle nicht. Deshalb darf der Screen
  **keine feste Restzeit** behaupten, außer der Generator rendert sie wirklich.
- Der Startbildschirm läuft nur beim Start aus dem Idle-Zustand und übergibt
  ohne RTMP-Neuaufbau an die Quelle.

---

## 2 Format und technischer Rahmen

| Parameter | Wert |
| --- | --- |
| Auflösung | `settings.video.resolution`, Default **720 × 1280** (9:16) |
| Seitenverhältnisse | 9:16 (TikTok-Standard), 16:9, 1:1 möglich |
| FPS | `settings.video.fps`, Default 25 |
| Video | H.264, `yuv420p`, Bitrate aus den Einstellungen, GOP ≈ 2 s |
| Audio | stiller AAC-Stereo, 48 kHz (der Sink braucht einen Audiostream) |
| Textfelder | `pause.text` / `pause.subtext`, je max. 200 Zeichen |
| Standardtexte | „Stream pausiert" / „Gleich geht es weiter" |
| Starttext | „Gleich geht's los." / „Der Stream startet in wenigen Minuten." |
| Assets | Bilder, GIF/WebP, MP4/WebM/MOV/MKV, statisches SVG, TTF/OTF |
| Upload-Limit | 50 MB pro Datei |
| Vorschau | `POST /api/pause/preview.png`, ein PNG-Frame |

Der Slate wird **in der Ausgabauflösung** gerendert, nicht in einer festen
Referenzgröße. Alle Maße in diesem Guide sind deshalb Prozent der Breite
(oder der Höhe), keine absoluten Pixel.

---

## 3 Komposition

### 3.1 Raster

```
┌──────────────────────────────────────────────┐
│ 5 % Rand                                     │
│   ┌──────────────────────────────────────┐   │
│   │ Logo-Zone        Status-Chip         │   │
│   │                                      │   │
│   │            EYEBROW                   │   │
│   │         HAUPTTEXT (7,1 %)            │   │
│   │            ───────                   │   │
│   │        Untertext (3,3 %)             │   │
│   │                                      │   │
│   │ Meta                        Meta     │   │
│   └──────────────────────────────────────┘   │
│                                              │
└──────────────────────────────────────────────┘
```

| Zone | Regel |
| --- | --- |
| Schutzraum | 5 % an allen Seiten (Overscan) |
| Textblock | max. 70 % der Breite, zentriert |
| Logo | oben links, 4–5 % der Breite, 5 % Rand |
| Status-Chip | oben rechts, gleiche Höhe wie Logo |
| Meta-Zeile | unten, 4,5 % Rand, max. 1,15 % Schrift |
| Verlauf | 2 px Oberkante oder kurze Linie unter dem Titel |

Alles, was Information trägt, liegt **innerhalb** der 5-%-Linie. Der äußere
Rand darf Wasserzeichen, Bloom oder Bewegtbild tragen, aber nichts Wichtiges.

### 3.2 Zentrierter Stack

Der Stack ist zentriert. Die folgenden Werte sind Zielwerte; die aktuelle
Implementierung steht in 3.3:

1. Eyebrow (Mono, Großbuchstaben, `.28em`; heute Teil des Assets)
2. Haupttext (Display, 700, 7,1 % der Breite)
3. Verlaufslinie (8 % Breite, 2 px)
4. Untertext (UI, 400, 3,3 % der Breite)

Der Abstand zwischen Haupt- und Untertext beträgt **2,2 % der Breite**
(≈ 42 px bei 1920, 24 px bei 1080, 16 px bei 720).

### 3.3 Was der Renderer heute macht

Damit Design und Technik nicht auseinanderlaufen:

- Haupttext: `fontsize = round(width / 14)` → 7,14 % der Breite.
- Untertext: `fontsize = round(width / 30)` → 3,33 % der Breite, Deckkraft 70 %.
- Position: `y = (h - th) / 2 - 40` bzw. `+ 60` – **feste Pixel**, nicht
  proportional. Bei 720 × 1280 sitzt der Block dadurch relativ tiefer als bei
  1920 × 1080.
- Kein Zeilenumbruch, keine Breitenbegrenzung, kein Scrim, kein Logo-Layer.
- Nur zwei Textlayer. Eyebrow, Logo und Meta sind heute Teil des
  Hintergrund-Assets.

Der Generator-Guide beschreibt, wie diese Werte proportional werden. Bis
dahin gilt: **Assets so bauen, dass sie mit den festen Offsets funktionieren**,
und die Vorschau bei der tatsächlichen Zielauflösung prüfen.

### 3.4 Overlays und Slates

Overlays werden **im Sink** über das Quellbild gelegt, nicht in den Slate
gerendert. Chat (Default unten links), Uhr (oben rechts), Text (oben links)
und Einnahmen bleiben deshalb heute auch dann sichtbar, wenn der Pausenscreen
läuft.

Daraus folgen zwei Modi:

| Modus | Regel | Status |
| --- | --- | --- |
| **Clean** (empfohlen) | Chat und Einnahmen während Pause/Start ausblenden; Uhr/Text nur außerhalb des Textblocks | Ziel, noch nicht automatisch |
| **Overlay-sicher** | Ecken zu 25 % freihalten, Brand mittig unter den Stack, kein Status-Chip | Fallback für heute |

Die Mocks zeigen den **Clean-Mode**. Solange Overlays aktiv bleiben:

- Logo nicht oben links (kollidiert mit Text-Overlay).
- Status-Chip nicht oben rechts (kollidiert mit Uhr).
- Meta-Zeile nicht unten links (kollidiert mit Chat).
- Der zentrierte Textblock bleibt in beiden Modi unverändert.

Chat-Nachrichten aus der Zeit vor der Pause sind nach wenigen Minuten veraltet
und konkurrieren mit der Botschaft des Slates. Für den Zuschauer ist „Pause"
klarer als ein eingefrorener Chat. Deshalb ist Clean der Standard; die
Umsetzung gehört in den Supervisor, nicht in jedes Preset.

---

## 4 Typografie

### 4.1 Schriftwahl

- **Eine Schriftdatei** versorgt heute beide Zeilen. Empfohlen ist ein
  geometrischer Sans mit gutem Regular/Medium, z. B. Space Grotesk Medium
  oder Inter Medium.
- Variable Fonts rendern in ffmpeg nur ihre Default-Instanz. Für
  reproduzierbare Ergebnisse statische Schnitte hochladen.
- Der Untertext wird heute nicht kursiv, nicht gesperrt und nicht in einer
  zweiten Familie gesetzt.
- Ziel (Generator-Roadmap): getrennte Schriften für Titel und Untertext
  (`title_font`, `sub_font`). Dann Space Grotesk 700 + Inter 400.

### 4.2 Größen und Grenzen

| Element | Größe | Gewicht | Zeichen |
| --- | --- | --- | --- |
| Haupttext | 7,1 % der Breite | 600–700 | **max. 20** |
| Untertext | 3,3 % der Breite | 400 | **max. 40** |
| Eyebrow | 1,2 % der Breite | Mono 600 | max. 24 |
| Meta | 1,15 % der Breite | Mono 400 | max. 32 |

Die Zeichenlimits sind konservativ gerechnet (≈ 0,5 em pro Zeichen, 70 %
Textbreite). Großbuchstaben, breite Schriften und lange Wörter brauchen mehr
Platz: im Zweifel kürzen.

**Keine Zeilenumbrüche.** `drawtext` bricht nicht um; ein zu langer Satz läuft
aus dem Bild. Zwei kurze Zeilen sind besser als eine lange.

### 4.3 Satz

- Haupttext: Satzzeichen ja, Ausrufezeichen nein. Ein Punkt am Ende ist
  erlaubt und beruhigt.
- Untertext: ein Satz, keine Aufzählung, keine Klammern.
- Keine Emojis (Font-Fallback, Farbe, Skalierung).
- Keine Deko-Großbuchstaben im Haupttext; Großbuchstaben nur für Eyebrow und
  Meta.
- Umlaute und ß sind erlaubt; Schrift muss sie enthalten.

---

## 5 Farbe und Kontrast

### 5.1 Paletten

| Vorlage | Hintergrund | Text | Akzent |
| --- | --- | --- | --- |
| Neon Pause | `#0B1017` + Bloom | `#EAF2FF` | `#DFFF4F` |
| Papier Pause | `#F4EAD8` | `#1D1913` | `#E96A45` |
| Neon Start | `#0B1017` + Violett-Bloom | `#EAF2FF` | `#B05CFF` |
| Night Pause | `#07090F` | `#EAF2FF` | `#DFFF4F` |

Der Untertext ist heute **dieselbe Farbe mit 70 % Deckkraft**. Auf dunklem
Grund entsteht so ein ruhiger Sekundärton; auf Papier funktioniert das nur mit
Tinte, nicht mit Lime.

### 5.2 Kontrast

- Haupttext ≥ **4,5 : 1** gegen den dunkelsten/hellsten Punkt *unter dem Text*,
  nicht gegen den Durchschnitt des Bildes.
- Wegen der 70-%-Deckkraft des Untertexts: Textfarbe so wählen, dass auch die
  abgeschwächte Variante noch 4,5 : 1 erreicht. Bei `#EAF2FF` auf `#0B1017`
  ist das gegeben; bei Grau auf Video nicht automatisch.
- Über Foto/Video: **Scrim 45–60 %** in Schwarz (dunkle Vorlage) oder Creme
  (Papier-Vorlage). Der Scrim liegt zwischen Bild und Text.
- Lime ist auf Papier eine Flächenfarbe, kein Textton. Für Papier gilt
  `#55701A` oder Tinte.
- Kein Text direkt auf unruhigen Details (Gesichter, Kanten, Schrift im Bild).

### 5.3 Signalfarben

- **Lime** = Pause/Signal, **Violett** = Start, **Cyan** = Information.
- Maximal eine Signalfarbe pro Slate.
- Der Verlauf erscheint einmal: als 2-px-Oberkante, kurze Linie oder im Logo.
  Nicht als Textfarbe für den ganzen Satz.

---

## 6 Hintergrund

### 6.1 Erlaubte Typen

| Typ | Verhalten | Empfehlung |
| --- | --- | --- |
| Farbe | `pause.color` / `startup.color` | ruhiger Standard, wenn kein Asset da ist |
| Bild | PNG/JPG/WebP/BMP/AVIF | 9:16 oder 16:9 passend zur Ausgabe |
| Video | MP4/WebM/MOV/MKV, geloopt | 6–12 s, nahtlos, ohne Ton |
| GIF/WebP | animiert, geloopt | nur wenn WebM nicht möglich; Dateigröße prüfen |
| SVG | statisch gerastert | Logo/Ornament, kein animiertes SVG |
| Kein Asset | Farbfläche | immer gültig, nie „schwarz mit nichts" |

### 6.2 Bewegung

- Loop **6–12 s**, nahtlos; harter Sprung am Loop-Ende ist sichtbar.
- Bewegung nur außerhalb des Textblocks (Bloom, Grid, Partikel am Rand).
- Keine Blitze, kein Flackern > 3 Hz, keine schnellen Schnitte.
- Keine Kamerafahrten, die den Text hinter sich herziehen.
- Bei 25 fps aufnehmen oder in 25/30 fps liefern.

### 6.3 Fit-Modi

| Modus | Verhalten | Einsatz |
| --- | --- | --- |
| `cover` | füllt, beschneidet | Default; Motiv mittig halten |
| `contain` | passt ein, Ränder in `pause.color` | nur wenn das Asset nicht beschnitten werden darf |
| `stretch` | verzerrt exakt | vermeiden; nur für abstrakte Muster |

Ein 16:9-Asset im 9:16-Output verliert bei `cover` rund 44 % der Breite.
Deshalb: Assets im Zielformat produzieren.

### 6.4 Dateien

- 9:16: 1080 × 1920 oder 720 × 1280; 16:9: 1920 × 1080 oder 1280 × 720.
- Bilder als PNG/WebP, Videos als WebM (VP9) oder MP4 (H.264).
- Max. 50 MB; für Loops eher < 10 MB anstreben.
- Keine Audiospur nötig; der Slate erzeugt Stille selbst.
- Keine Schrift im Asset, die mit dem Live-Text konkurriert.

---

## 7 Vorlagen

Vier Vorlagen decken den Betrieb ab. Sie sind als Presets im Generator
hinterlegt und füllen die bestehenden Felder.

| Vorlage | Screen | Hintergrund | Haupttext | Untertext | Fit |
| --- | --- | --- | --- | --- | --- |
| **Neon Pause** | Pause | `#0B1017` + Cyan/Violett-Bloom | „Kurz durchatmen." | „Wir sind gleich zurück." | cover |
| **Papier Pause** | Pause | `#F4EAD8` + Papierkorn | „Kurz durchatmen." | „Wir sind gleich zurück." | cover |
| **Neon Start** | Start | `#0B1017` + Violett/Cyan-Bloom | „Gleich geht's los." | „Der Stream startet in wenigen Minuten." | cover |
| **Night Pause** | Pause | `#07090F`, kein Bloom | „Kurz durchatmen." | „Wir sind gleich zurück." | cover |

Regeln für Presets:

- Ein Preset ändert **nie** die Dauer, die Grace-Periode oder die
  Pausenlogik. Es setzt nur Darstellung und Texte.
- Presets sind Startpunkte, keine Sperre: Texte bleiben editierbar.
- Ein Preset darf den Hintergrund ersetzen, aber nicht stillschweigend
  vorhandene Assets löschen; der Generator fragt nach.
- „Papier Pause" ist der Tagesmodus, „Neon Pause" der Abendmodus,
  „Night Pause" der minimalistische Fallback.

---

## 8 Inhalt

### 8.1 Pause

Automatische Pause (Quelle weg):

| Haupttext | Untertext | Zeichen |
| --- | --- | --- |
| Kurz durchatmen. | Wir sind gleich zurück. | 16 / 22 |
| Verbindung weg. | Wir holen die Quelle zurück. | 15 / 29 |
| Gleich weiter. | Die Übertragung bleibt bestehen. | 14 / 33 |
| Pause. | Wir sind in wenigen Minuten zurück. | 6 / 34 |

Manuelle Pause:

| Haupttext | Untertext |
| --- | --- |
| Kurze Pause. | Wir sind gleich wieder da. |
| Wir machen Pause. | Danke fürs Zuschauen. |
| Bis gleich. | Der Stream läuft weiter. |

Regeln:

- Keine Uhrzeit, keine Minutenangabe, kein Countdown – außer der Generator
  rendert ihn aus einer echten Quelle.
- Nicht „Offline" schreiben, wenn der Stream live bleibt. Der Zuschauer sieht
  den Kanal; „Pause" ist ehrlich, „Offline" ist falsch.
- Kein „Bitte warten" ohne Grund; ein Satz, was passiert.

### 8.2 Start

| Haupttext | Untertext |
| --- | --- |
| Gleich geht's los. | Der Stream startet in wenigen Minuten. |
| Fast bereit. | Wir schalten gleich live. |
| Start in Kürze. | Bleib dran. |
| Wir sind gleich live. | Der Startbildschirm läuft noch kurz. |

Regeln:

- Keine exakte Startzeit nennen, wenn sie nicht feststeht.
- „Gleich" ist erlaubt; „in 2 Minuten" nur mit echtem Countdown.
- Der Startbildschirm ist kein Trailer: kein „Jetzt abonnieren", kein
  Gewinnspiel, keine Musikempfehlung.

### 8.3 Tonalität

Deutsch, Du-Form, ruhig. Ein Satz, ein Punkt. Keine Ausrufezeichen, keine
Superlative, keine Emojis. Der Screen spricht den Zuschauer nicht mit Namen an
und entschuldigt sich nicht in Schleifen.

---

## 9 Markenelemente

- **Logo:** heute nicht vom Generator gezeichnet. Entweder fest ins
  Hintergrund-Asset integrieren oder als eigenen Layer ergänzen (Roadmap).
  Position: oben links, 5 % Rand, Höhe 4–5 % der Breite.
- **Wortmarke:** RELAY in Space Grotesk, Laufweite `.22em`, „restreamer" in
  Mono darunter.
- **Verlauf:** 2 px Oberkante oder kurze Linie, nie als Vollfläche.
- **Meta-Zeile:** unten links/rechts in Mono 1,15 %, ohne Buttons und ohne
  Bedienleiste. Sie trägt die Marke, nicht die Konfiguration.
- **Status-Chip:** „PAUSE" in Lime, „START" in Violett, mit LED-Punkt.
- **Keine Konfiguration auf dem Screen:** keine Maximaldauer, keine Bitrate,
  keine IDs. Der Slate ist für Zuschauer, nicht für Admins.

---

## 10 Lesbarkeit und Barrierefreiheit

- Test bei **50 % Skalierung** (Smartphone) und auf einem TV aus 3 m.
- Haupttext muss auch bei 360p lesbar bleiben: 7,1 % der Breite ist die
  Untergrenze, nicht das Ziel.
- Kontrast über dem **schlechtesten** Bildbereich prüfen, nicht über dem
  Mittelwert.
- KeineInformation ausschließlich über Farbe (Chip hat Text + LED).
- Keine hektischen Bewegungen; `prefers-reduced-motion` betrifft die App,
  nicht das Video – deshalb Bewegung im Asset von vornherein reduzieren.
- Keine blinkenden Warnungen, keine Frequenzen über 3 Hz.
- Untertitel/Transkript sind für einen statischen Slate nicht nötig, aber der
  Text muss ohne Audio verständlich sein (er ist der einzige Inhalt).
- Bei Sprachvarianten: Textlängen im Zielsprachenland prüfen; 20/40 gelten
  für Deutsch.

---

## 11 Produktion

### 11.1 Asset-Checkliste

- [ ] Zielformat und -auflösung passen zur Ausgabe (9:16 oder 16:9)
- [ ] Textzone (mittig, 70 % Breite) bleibt ruhig und kontrastreich
- [ ] Scrim eingebaut, falls Foto/Video
- [ ] Loop nahtlos, 6–12 s, kein Sprung
- [ ] Keine Blitze, kein Flackern, keine schnellen Schnitte
- [ ] Logo im Asset korrekt platziert (5 % Rand, 4–5 % Breite)
- [ ] Kein Text im Asset, der mit dem Live-Text kollidiert
- [ ] Datei ≤ 50 MB, Codec korrekt, kein Ton nötig
- [ ] Overlay-Modus entschieden (Clean oder overlay-sicher)
- [ ] Vorschau bei Zielauflösung geprüft

### 11.2 Text-Checkliste

- [ ] Haupttext ≤ 20 Zeichen, Untertext ≤ 40
- [ ] Kein Zeilenumbruch, keine Aufzählung
- [ ] Keine erfundene Zeitangabe
- [ ] Keine Emojis, keine Ausrufezeichen
- [ ] Deutsch, Du-Form, ein Satz pro Zeile
- [ ] Umlaute im Font vorhanden

### 11.3 Abnahme

1. Vorschau im Generator mit Zielauflösung erzeugen.
2. Auf 50 % verkleinern und aus 1 m Entfernung prüfen.
3. Kontrast über dem hellsten und dunkelsten Bildpunkt prüfen.
4. 30 s laufen lassen: Loop-Sprung, Flackern, Lesbarkeit.
5. Speichern, Pause manuell starten, im Dashboard gegenprüfen.

---

## 12 Don'ts

| Don't | Warum |
| --- | --- |
| 200 Zeichen in den Haupttext | läuft aus dem Bild, drawtext bricht nicht um |
| „Offline" bei laufendem Sink | der Kanal ist live, nur die Quelle fehlt |
| Countdown ohne echte Quelle | bricht ein Versprechen |
| Weißer Text auf hellem Video | Kontrast unter 4,5 : 1 |
| Animiertes SVG als Loop | wird statisch gerendert |
| 16:9-Asset im 9:16-Output | verliert 44 % der Breite |
| Logo als Wasserzeichen hinter dem Text | stört Lesbarkeit |
| Chat/Einnahmen im Pausenbild stehen lassen | veraltete Nachrichten, Kollision mit dem Slate |
| Dauer/Bitrate auf dem Screen | ist Admin-Info, nicht Zuschauer-Info |
