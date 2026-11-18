# RELAY · Styleguide Slate-Generatoren

Regeln für den Code und die Oberfläche, die Pausen- und Startbildschirme
erzeugen. Der Guide beschreibt den heutigen Stand, die Zielwerte und die
Reihenfolge, in der beides zusammenwächst.

- **Version:** 1.0 (Arbeitsstand)
- **Gehört zu:** [`docs/DESIGN.md`](../DESIGN.md),
  [`docs/design/PAUSE-SCREENS.md`](./PAUSE-SCREENS.md)
- **UI-Mock:** [`docs/design/mockups/f-slate-generator.html`](./mockups/f-slate-generator.html)
- **Slate-Mock:** [`docs/design/mockups/e-pause-screens.html`](./mockups/e-pause-screens.html)

## Kurzfassung

Der Generator ist kein Bildeditor. Er füllt eine geprüfte Vorlage mit zwei
Texten und einem Asset. Alles, was das Layout betrifft, gehört in den
Generator – nicht in die Hände der Bedienperson.

Vier Regeln:

1. **Vorschau und Live teilen denselben Filtergraph.** Kein zweiter Renderer.
2. **Das Layout ist Code, der Inhalt ist Eingabe.** Keine freien Positionen.
3. **Fehler sind sichtbar, nie still.** Fehlende Schrift heißt Warnung, nicht
   unsichtbarer Text.
4. **Assets sind fremd.** Größe, Typ, Herkunft und Laufzeit werden geprüft.

---

## 1 Aufgabe und Komponenten

| Baustein | Datei | Aufgabe |
| --- | --- | --- |
| Filtergraph | `src/core/source/ffmpeg.ts` (`buildSlateFilters`) | Skalierung, Fit, Textlayer |
| Live-Renderer | `src/core/source/ffmpeg.ts` (`buildPauseCommand`) | MPEG-TS-Slate in den Relay |
| Vorschau-Renderer | `src/core/source/ffmpeg.ts` (`buildPausePreviewArgs`) | ein PNG-Frame |
| Slate-Lebenszyklus | `src/core/overlays/pause-screen.ts` | Start/Stop, SVG-Rasterung |
| Vorschau-Service | `src/core/overlays/pause-preview.ts` | Draft mergen, PNG liefern |
| Asset-Prüfung | `src/core/overlays/pause-assets.ts` | Magic Bytes, Typen, Namen |
| Schriftauflösung | `src/core/overlays/drawtext.ts` (`resolveFont`) | Upload oder System-Fallback |
| API | `src/api/routes/system.ts`, `pause-assets.ts` | Preview, Upload, Liste, Löschen |
| Einstellungen | `src/core/config/schema.ts` | `pause` und `startup` |
| UI | `src/web/src/views/SettingsView.vue` | Formular, Upload, Vorschau |

Der Generator ist heute über die Einstellungen verteilt. Ziel ist ein
gemeinsames Modul (`slate-layout.ts` + `slate-presets.ts`), das Renderer, API
und UI gemeinsam nutzen.

---

## 2 Prinzipien

1. **Eine Quelle der Wahrheit.** Presets, Layout-Tokens und Validierung liegen
   serverseitig. Die UI liest sie, sie dupliziert sie nicht.
2. **Vorschau = Live.** Beide rufen `buildSlateFilters` auf. Abweichungen sind
   nur erlaubt, wo sie dokumentiert sind (z. B. Loop vs. Einzelframe).
3. **Deterministisch.** Gleiche Einstellungen und gleiches Asset ergeben
   dieselben Maße und dieselbe Schrift. Kein Zufall, keine Zeitabhängigkeit im
   Layout.
4. **Sicher scheitern.** Fehlt die Schrift oder das Asset, wird der Slate mit
   Farbe und Fallback-Schrift gerendert und gewarnt – nie ohne Text und nie
   ohne Log.
5. **Inhalt ist frei, Layout nicht.** Die Bedienperson ändert Texte, Farben,
   Asset und Preset; sie verschiebt keine Layer.
6. **Bewegung ist ein Asset, kein Filter.** Der Generator animiert keine
   Schrift, keine Partikel und keine Countdowns, solange es dafür keine
   ausdrückliche Funktion gibt.

---

## 3 Datenmodell

### 3.1 Heute

```ts
// Settings.pause
{
  enabled: boolean;
  text: string;            // max. 200
  subtext: string;         // max. 200
  color: string;           // 0xRRGGBB | #RRGGBB
  max_minutes: number;     // 0 = unbegrenzt
  grace_seconds: number;
  background: string;      // Pfad oder URL, leer = Farbe
  font: string;            // Pfad zu TTF/OTF, leer = Fallback
  text_color: string;      // drawtext-Farbe, max. 64 Zeichen
  fit: 'cover' | 'contain' | 'stretch';
}
```

`startup` ist identisch, aber ohne `max_minutes`/`grace_seconds` und mit
`duration_seconds`. Ein echtes `label` (Eyebrow) gibt es nicht; es ist heute
Teil des Hintergrund-Assets.

### 3.2 Zielmodell (additiv, Defaults erhalten das Verhalten)

```ts
interface SlateSettings {
  preset_id?: string;        // 'pause-neon' | 'pause-paper' | 'start-neon'
  label?: string;            // Eyebrow, max. 24 Zeichen
  scrim?: number;            // 0..80, Prozent Abdunklung
  title_font?: string;       // getrennte Schrift für den Titel
  sub_font?: string;         // getrennte Schrift für den Untertext
  logo?: string;             // Asset-Pfad, optionaler Layer
  accent?: string;           // 0xRRGGBB | #RRGGBB
  overlay_mode?: 'clean' | 'safe';
}
```

Alle Felder sind optional. Ohne sie rendert der Generator exakt wie heute.
Das ist die Voraussetzung dafür, dass die Migration ohne Bruch läuft.

### 3.3 Presets

Ein Preset ist Daten, kein Sonderpfad im Code:

```json
{
  "id": "pause-neon",
  "version": 1,
  "screen": "pause",
  "name": "Neon Pause",
  "label": "Stream pausiert",
  "title": "Kurz durchatmen.",
  "subtitle": "Wir sind gleich zurück.",
  "accent": "#DFFF4F",
  "text_color": "#EAF2FF",
  "background": { "kind": "color", "value": "#0B1017", "fit": "cover", "scrim": 50 },
  "type": { "title_font": "Space Grotesk", "sub_font": "Inter" },
  "layout": "center",
  "overlay_mode": "clean"
}
```

Regeln:

- Presets setzen **keine** Pausenlogik (`max_minutes`, `grace_seconds`,
  `duration_seconds`).
- Beim Anwenden werden vorhandene Assets nicht gelöscht; die UI fragt, ob der
  Hintergrund ersetzt werden soll.
- `version` erlaubt spätere Migration, ohne gespeicherte Settings zu brechen.
- Presets liegen in `src/core/overlays/slate-presets.ts` und werden über
  `GET /api/pause/presets` ausgeliefert.

---

## 4 Layout-Tokens

### 4.1 Formeln

| Token | Formel | Bedeutung |
| --- | --- | --- |
| `mainSize` | `round(width * 0.0714)` | Haupttext (heute `width / 14`) |
| `subSize` | `round(width * 0.0333)` | Untertext (heute `width / 30`) |
| `textWidth` | `width * 0.70` | maximaler Textblock |
| `mainTop` | `round(height / 2 - width * 0.037)` | Oberkante Haupttext |
| `subTop` | `round(height / 2 + width * 0.0556)` | Oberkante Untertext |
| `margin` | `width * 0.05` | Schutzraum |
| `scrim` | `0..0.80` | Abdunklung über dem Asset |

`mainTop`/`subTop` sind Zielwerte. Heute sind die Offsets mit **−40 px** und
**+60 px** fest verdrahtet; sie skalieren nicht mit der Auflösung.

### 4.2 Werte

| Auflage | `mainSize` | `subSize` | `mainTop` | `subTop` | `textWidth` |
| --- | --- | --- | --- | --- | --- |
| 720 × 1280 | 51 | 24 | 613 | 680 | 504 |
| 1080 × 1920 | 77 | 36 | 920 | 1020 | 756 |
| 1920 × 1080 | 137 | 64 | 469 | 647 | 1344 |

Die Tabelle ist die Referenz für Tests und Golden Frames. Weicht die
Implementierung ab, ist das ein Bug – nicht eine Designentscheidung.

### 4.3 Zeichenlimits

Die Limits ergeben sich aus der Breite, nicht aus einer festen Zahl:

```
maxChars = floor(textWidth / (0.52 * fontSize))
```

- Haupttext: ≈ 19 Zeichen → Empfehlung **20**.
- Untertext: ≈ 40 Zeichen → Empfehlung **40**.
- Großbuchstaben und breite Schriften: 20 % abziehen.
- Harte Schema-Grenze bleibt 200 Zeichen, aber alles über dem Limit ist ein
  Warnfall und wird in der UI markiert.

---

## 5 Rendering

### 5.1 Filterkette

```text
[background]
  → scale + crop/pad (fit)
  → setsar=1, fps
  → drawtext (Haupttext)
  → drawtext (Untertext)
  → libx264 → MPEG-TS → Relay
```

- Fit: `cover` (Default), `contain` (Padding in `color`), `stretch` (verzerrt).
- Text wird nur gezeichnet, wenn `fontFile` **und** Text vorhanden sind.
- `drawtext` bricht nicht um. Zeilenumbrüche sind kein Feature.
- Die Vorschau nutzt exakt dieselben Filter, aber `-frames:v 1 -an`.

### 5.2 Escaping

Text läuft durch eine Escaping-Funktion für `\ ' : % , [ ]`. Zwei Punkte sind
offen:

- `escapeDrawtext` existiert doppelt (`ffmpeg.ts` und `drawtext.ts`) und
  behandelt `;` unterschiedlich. Vereinheitlichen, sonst bricht ein Semikolon
  den Filtergraphen.
- Steuerzeichen und Zeilenumbrüche vor dem Escaping entfernen.

### 5.3 Schrift

- Heute eine Datei für beide Zeilen. Variable Fonts rendern ihre
  Default-Instanz; Gewicht ist nicht wählbar.
- `resolveFont` fällt auf DejaVu/Noto/Liberation zurück. Fehlt alles, wird
  **kein Text** gezeichnet. Das ist der gefährlichste stille Fehler.
- Ziel: `title_font`/`sub_font`, statische Schnitte, im Container gebündelt.
- Empfehlung bis dahin: eine statische Medium-Schrift, die bei 51 px und
  24 px funktioniert.

### 5.4 Encoding

| Parameter | Wert |
| --- | --- |
| Codec | H.264, `veryfast`, `yuv420p` |
| Bitrate | `video_bitrate` aus den Einstellungen |
| GOP | `fps * 2` |
| Audio | stiller AAC-Stereo, 48 kHz |
| Container | MPEG-TS mit `+resend_headers` |
| Standbild | `-tune stillimage` bei Farbe/Bild |
| Loop | Video/GIF: `-stream_loop -1 -re`; Bild: `-loop 1 -re` |

Der Timestamp-Offset bleibt Aufgabe des Supervisors; der Generator liefert nur
die Args.

---

## 6 Vorschau

### 6.1 Vertrag

- Endpoint: `POST /api/pause/preview.png` mit `screen` und Draft-Feldern.
- Antwort: ein PNG in der **echten Ausgabauflösung**, `no-store`.
- Gleiche Filter wie live, inklusive Schrift, Fit und Farbe.
- Timeout: 20 s; Fehler als JSON, nicht als leerer Frame.
- Vorschau zeigt den Slate **ohne Sink-Overlays**. Im Clean-Mode entspricht
  das dem Endbild; im Overlay-sicheren Modus ist die Vorschau unvollständig
  und muss darauf hinweisen.

### 6.2 UI-Verhalten

- 350 ms Debounce, vorherige Anfrage wird abgebrochen (`AbortController`).
- Nur die sichtbare Fläche rendern; heute werden unnötig beide Screens
  erzeugt.
- Letztes gutes Bild bleibt bei Fehlern stehen; Fehlertext darunter.
- Ladezustand sichtbar, aber ohne Layoutsprung.
- Die Vorschau zeigt immer das Seitenverhältnis der Ausgabe. Kein festes 16:9.

### 6.3 Bekannte Unterschiede

| Vorschau | Live |
| --- | --- |
| ein Frame | Loop über die gesamte Pause |
| Video bei t = 0 | Loop ab Start |
| keine Sink-Overlays | Overlays je nach Modus |
| PNG | MPEG-TS |

Diese Unterschiede sind zu dokumentieren, nicht zu verstecken.

---

## 7 Assets

### 7.1 Prüfung

| Prüfung | Regel |
| --- | --- |
| Größe | ≤ 50 MB, Upload komplett im Speicher |
| Endung | Whitelist (Bilder, Videos, GIF, SVG, TTF/OTF) |
| Magic Bytes | PNG/JPEG/GIF/WebP/BMP/MP4/WebM/TTF/OTF |
| SVG | `<svg`-Wurzel; animierte SVGs nur mit Warnung |
| Schrift | TTF/OTF-Signatur |
| Name | `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, kein `..` |
| Ablage | `data/pause/`, Modus `0600`, Name `pause-<ts>-<hex>.<ext>` |

### 7.2 Remote-URLs

- Nur `http`/`https` erlauben; keine `file:`-, `rtmp:`- oder `data:`-URLs.
- Private und link-lokale Adressen blocken (SSRF), DNS-Auflösung prüfen.
- Timeout 15 s, Größenlimit auch für Remote-SVG.
- Nicht vertrauenswürdige URLs nie in ffmpeg-Argumente durchreichen, ohne
  Schema und Host zu prüfen.
- Remote-Assets nicht dauerhaft cachen, ohne Fingerprint.

### 7.3 Aufräumen

- Beim Löschen eines Assets prüfen, ob es noch in `pause` oder `startup`
  referenziert wird; sonst Warnung.
- Rasterisierte SVGs (`pause-background.png`) bei neuem Upload ersetzen, nicht
  sammeln.
- Keine Pfade in API-Antworten ausliefern; nur Dateinamen und Metadaten.

---

## 8 Validierung

### 8.1 Stufen

| Stufe | Verhalten |
| --- | --- |
| Fehler | Speichern blockiert (ungültige Farbe, fehlende Datei, Größe) |
| Warnung | Speichern möglich, aber Bestätigung nötig (Zeichenlimit, Kontrast) |
| Hinweis | nur Anzeige (Loop-Dauer, empfohlene Auflösung) |

### 8.2 Regeln

- **Textlänge:** serverseitig messen (Skia `measureText`) statt schätzen;
  Fallback auf die 0,52-em-Heuristik. Über 20/40 Zeichen: Warnung.
- **Kontrast:** bei Volltonfarbe berechnen. Bei Asset die Textregion im
  gerenderten Frame sampeln und den schlechtesten Punkt prüfen; unter 4,5 : 1
  warnen. Ohne Scrim bei Foto/Video immer warnen.
- **Farbe:** nur `#RRGGBB`, `0xRRGGBB` oder eine kurze Whitelist von
  drawtext-Namen. Keine freien Strings.
- **Schrift:** Datei existiert, Signatur gültig, Größe plausibel. Fehlt sie,
  Warnung + Fallback, nie stiller Verzicht.
- **Asset:** Typ, Auflösung, Seitenverhältnis, Dauer, Loop-Fähigkeit.
- **Fit:** `stretch` immer mit Hinweis auf Verzerrung.
- **Dauer:** Startbildschirm 0–300 s; Pause 0–1440 min.
- **Overlay-Modus:** `clean` empfohlen; `safe` nur mit Layout-Prüfung.

### 8.3 Antwortformat

Warnungen gehören an die Vorschau-Antwort (Header oder JSON) **und** an die
Speicher-Antwort, damit die UI nicht raten muss:

```json
{
  "ok": true,
  "warnings": [
    { "code": "text_too_long", "field": "text", "message": "24 / 20 Zeichen" },
    { "code": "low_contrast", "field": "text_color", "message": "3,9 : 1 über dem hellsten Bildpunkt" }
  ]
}
```

---

## 9 Generator-Oberfläche

Der Mock zeigt die Zieloberfläche. Regeln:

### 9.1 Aufbau

1. **Vorschau zuerst.** Links, groß, im echten Seitenverhältnis.
2. **Vorlagen** als Chips oder Karten, max. eine Zeile.
3. **Inhalt:** Haupttext, Untertext, Zähler direkt am Feld.
4. **Gestaltung:** Schrift, Textfarbe, Akzent, Fit – nicht mehr als vier
   Regler.
5. **Hintergrund:** Asset-Zeile mit Metadaten, Ersetzen/Entfernen, Scrim.
6. **Validierung:** eine ruhige Zeile unter der Vorschau, keine roten Balken
   für Hinweise.
7. **Aktionen:** „Speichern" primär, „Verwerfen" ghost; „Vorschau" nur, wenn
   nicht automatisch gerendert wird.

### 9.2 Regeln

- Änderungen rendern automatisch nach 350 ms; kein Button-Zwang.
- Zähler zeigen `aktuell / Limit`, Warnfarbe erst über dem Limit.
- Preset-Wechsel fragt, bevor er Texte oder Assets überschreibt.
- Ungespeicherte Änderungen sind sichtbar (Punkt am Titel, „Gespeichert 17:42").
- Keine freie Positionierung, keine Drag-Handles, keine Ebenenliste.
- Die Vorschau ist nie kleiner als 320 px breit; auf Mobile steht sie oben.
- Formulare bleiben einspaltig unter 900 px.
- Fehlermeldungen nennen Feld und Folge, nicht nur „ungültig".

### 9.3 Mobile

- Vorschau 16:9 oder 9:16, max. 45 % der Viewporthöhe.
- Sticky Save-Leiste unten, Safe-Area beachten.
- Upload-Buttons mit 38 px Höhe, Eingaben 16 px gegen iOS-Zoom.
- Presets horizontal scrollbar, mit sichtbarem Rand.

---

## 10 API und Persistenz

### 10.1 Vorhanden

| Methode | Route | Zweck |
| --- | --- | --- |
| `POST` | `/api/pause/preview.png` | PNG-Vorschau |
| `POST` | `/api/pause/start` / `stop` | manueller Screen |
| `GET` | `/api/pause/assets` | Liste |
| `POST` | `/api/pause/assets` | Upload |
| `GET` | `/api/pause/assets/:filename` | Ausliefern |
| `DELETE` | `/api/pause/assets/:filename` | Löschen |
| `PUT` | `/api/settings` | Speichern |

### 10.2 Vorschlag

| Methode | Route | Zweck |
| --- | --- | --- |
| `GET` | `/api/pause/presets` | Preset-Liste, serverseitig |
| `POST` | `/api/pause/validate` | Textmaß, Kontrast, Warnungen ohne Rendern |
| `GET` | `/api/pause/capabilities` | Fonts, Formate, Limits, Version |

Regeln:

- Keine Serverpfade in Antworten; nur Dateinamen.
- Presets sind read-only; Anwenden geschieht über `PUT /api/settings`.
- Assets und Presets werden nie implizit gelöscht.
- Antworten mit `no-store`, wenn sie von Drafts abhängen.

---

## 11 Robustheit und Performance

- **Ziel:** Vorschau < 2 s, erster Live-Frame < 1 s. Beides messen, nicht
  annehmen.
- Schrift und gerasterte SVGs pro Settings-Fingerprint cachen; nicht bei
  jedem Frame neu schreiben.
- Uploads nicht unbegrenzt puffern; 50 MB sind die harte Grenze, früher
  abbrechen.
- Parallele Vorschauen abbrechen; nur die letzte Anfrage gewinnt.
- Beim Start des Slates darf ein Asset-Fehler den Sink nicht stoppen:
  Fallback auf Farbe, Warnung loggen.
- `pause-screen` und `startup-screen` teilen den Code; keine zweite
  Kopie der Filter.

### Fehlerfälle

| Fall | Verhalten |
| --- | --- |
| Font fehlt | Fallback-Font; wenn keiner: Farbe + Warnung, nie textlos |
| Asset fehlt | Farbfläche + Warnung |
| SVG animiert | erstes Frame + Warnung |
| Video defekt | Farbfläche + Warnung, Pause läuft weiter |
| Vorschau-Timeout | letztes Bild behalten, Fehlertext |
| Speichern ungültig | 400 mit Feldfehler, keine Teilübernahme |

---

## 12 Tests

### 12.1 Unit

- `buildSlateFilters` für 720 × 1280, 1080 × 1920, 1920 × 1080:
  Fontgrößen, Textbreite, Offsets.
- Escaping für `'`, `:`, `,`, `;`, `%`, `[`, `]`, Backslash.
- Fit-Modi inklusive `contain`-Padding und `stretch`.
- `resolveFont`: Upload, Fallback, kein Font.

### 12.2 API

- Preview liefert PNG in Zielauflösung; ungültige Parameter → 400.
- Upload: 50-MB-Grenze, Magic Bytes, Endung, Namensprüfung.
- Delete: Referenz in `pause`/`startup` wird erkannt.
- Keine Pfade in JSON-Antworten.

### 12.3 Visuell

- Golden Frames für vier Presets bei 720 × 1280 und 1920 × 1080.
- Differenzschwelle klein halten; Änderungen nur mit Absicht.
- Zusätzlich ein Frame mit `contain` und ein Frame mit Scrim.

### 12.4 E2E

- Text ändern → Vorschau aktualisiert nach Debounce.
- Speichern → Reload → Werte bleiben.
- Upload/Entfernen → Vorschau reagiert.
- Animiertes SVG → Warnung sichtbar.
- Mobile 320 px: kein horizontaler Overflow.

### 12.5 Manuell

- 30 s Loop auf Sprung und Flackern prüfen.
- 50-%-Skalierung auf Lesbarkeit prüfen.
- Kontrast über hellem und dunklem Bildbereich.
- Pause manuell starten und im Dashboard gegenprüfen.

---

## 13 Roadmap

| Phase | Inhalt | Abnahme |
| --- | --- | --- |
| 0 | Escaping vereinheitlichen, Pfade aus API entfernen, SSRF-Guard | Tests grün, keine Pfad-Leaks |
| 1 | `slate-layout.ts` mit Tokens, proportionale Offsets | Golden Frames stimmen |
| 2 | Presets-Modul + `label`, `scrim`, `preset_id` | Presets anwendbar, Defaults unverändert |
| 3 | Overlay-Politik (Clean) im Supervisor | Chat/Einnahmen aus bei Slate |
| 4 | Validierung + Warnungen in Preview/Save | Zähler und Kontrast sichtbar |
| 5 | Generator-UI nach Mock | Preset-Rail, Zähler, Scrim, Vorschau |
| 6 | Golden-Image-Tests in CI | Presets visuell abgesichert |

Reihenfolge ist bewusst: erst Sicherheit und Layout, dann Komfort. Kein Preset
der Welt hilft, wenn der Text aus dem Bild läuft.

---

## 14 Review-Checkliste

- [ ] Vorschau und Live nutzen denselben Filtergraph?
- [ ] Fontgrößen und Offsets kommen aus Tokens, nicht aus Literalen?
- [ ] Zeichenlimits werden gemessen und gewarnt?
- [ ] Kontrast geprüft, inklusive Scrim und Untertext-Alpha?
- [ ] Fehlende Font/Asset führen zu Warnung + Fallback, nie zu stillem Weglassen?
- [ ] Assets: Typ, Größe, Herkunft, Schema geprüft?
- [ ] Remote-URLs nur http/https, keine privaten Netze?
- [ ] Keine Serverpfade in API-Antworten?
- [ ] Presets ändern keine Pausenlogik?
- [ ] Vorschau bricht alte Anfragen ab und zeigt das letzte gute Bild?
- [ ] Overlay-Modus entschieden und in der Vorschau erklärt?
- [ ] Golden Frames für 9:16 und 16:9 vorhanden?
- [ ] Mobile: Vorschau oben, Save-Leiste unten, 16-px-Inputs?
