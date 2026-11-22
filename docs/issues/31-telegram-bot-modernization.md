## Ziel

Den integrierten Telegram-Bot grundlegend modernisieren und die Möglichkeiten der modernen Telegram Bot API (v6.x / v7.x / v8.x) voll ausschöpfen. Neben der Fernsteuerung per Text und simplen Inline-Keyboards soll der Bot zu einem modernen mobilen Leitstand ausgebaut werden – inklusive Telegram Web Apps (Mini Apps), Live-Vorschau-Bildern, interaktiver Regie-Steuerung, dynamischer Status-Updates und einer modularen Code-Architektur.

## Hintergrund

- Aktuell ist `src/core/telegram/bot.ts` eine über 2.300 Zeilen große monolithische Datei (84 KB).
- Der Bot nutzt bisher vor allem einfaches Polling (`getUpdates`), HTML-Textnachrichten und statische Inline-Buttons.
- Telegram bietet inzwischen mächtige Schnittstellen für Bots, die den RELAY-Workflow unterwegs massiv beschleunigen:
  - **Mini Apps / Web Apps:** Das Vue-Dashboard kann direkt im Chat per Menu-Button als Telegram Web App mit nativer Session gestartet werden.
  - **Media-API:** Screenshots und Preview-Frames können mit `sendPhoto` und `editMessageMedia` live gesendet und in-place aktualisiert werden.
  - **Chat Action & Menüführung:** `sendChatAction` signalisiert Bildgenerierung/Ladevorgänge, `setChatMenuButton` verankert das Dashboard fest im Chat.
  - **Erweiterte Formatierung:** Aufklappbare Zitate (`<blockquote expandable>`), Spoiler für sensible Daten und saubere grafische Indikatoren für Bitraten und Puffer.

## Kernfunktionen & Umsetzung

### 1. Telegram Web App / Mini App Integration
- **Menü-Button:** Konfiguration via `setChatMenuButton`, sodass unten links im Chat ein nativer Button „RELAY Cockpit“ erscheint, der das Web-Dashboard (`https://relay.positronium.dev`) direkt innerhalb Telegrams öffnet.
- **Nahtlose Authentifizierung:** Nutzung von `initData` / Telegram-Login-Handshake, um berechtigten Nutzern sofortigen Zugriff auf das Dashboard ohne erneute Passwortabfrage zu gewähren.
- **Deep-Links:** Inline-Buttons mit `web_app`-Attribut für Direktzugriff auf einzelne Bereiche (z. B. Stream-Deck-Touch-Buttons, Studio-Preview oder Regie-Queue).

### 2. Live-Vorschau & Bildübertragung (`sendPhoto`, `editMessageMedia`)
- Befehl `/preview` (bzw. Button im Statusmenü): Erzeugt einen aktuellen Frame aus dem Relay-MPEG-TS-Stream oder Studio-Canvas und versendet ihn als Foto (`sendPhoto`) mit kompakter Status-Caption (Streamer, Uptime, Bitrate, Zuschauer).
- Dynamische Aktualisierung: Bei Statusänderungen oder periodischen Snapshots wird das Bild per `editMessageMedia` in-place ausgetauscht, ohne den Chat zu überfluten.
- Ladeindikatoren: `sendChatAction(action: 'upload_photo')` während der Frame-Extraktion.

### 3. Erweiterte Regie- & Queue-Steuerung
- **Regie-Queue (`/queue`):** Interaktive Darstellung der aktiven Warteschlange mit Steuerungstasten (`[⏮ Seek -30s]`, `[⏭ Nächster]`, `[▶️ Sofort abspielen]`, `[🗑 Löschen]`).
- **Highlight-Marker & Clipping (`/marker`, `/clip`):** Schnelles Setzen von Zeitmarkern während des Streams; Ein-Klick-Aktion zum verlustfreien Remuxen als MP4-Clip und Transfer in die Medienbibliothek.
- **Szenen-Umschalter (`/scenes`):** Direkte Ein-Klick-Buttons für alle in `data/scenes.json` hinterlegten Szenen mit visueller Hervorhebung der aktiven Szene.

### 4. Live-Dashboard & Status-Formatierung
- **Pinned Live-Status (`pinChatMessage`):** Option, während eines laufenden Streams eine Live-Status-Nachricht anpinnen zu lassen, die alle 30–60 Sekunden in-place aktualisiert wird.
- **Grafische Balkenanzeigen:** Unicode-Fortschrittsbalken (`[██████░░░░]`) für Delay-Buffer-Füllstand, Quell-Bitrate und Quell-Watchdog-Zustand.
- **Aufklappbare Details:** Nutzung von `<blockquote expandable>` für detaillierte Diagnostics, ffprobe-Metadaten oder Log-Auszüge, um Nachrichten kompakt und lesbar zu halten.

### 5. Granulares Alerting mit Reaktions-Buttons
- **Stille vs. laute Benachrichtigungen:** Routine-Ereignisse (Streamer wechselt, Playlist-Fortschritt) senden stille Nachrichten (`disable_notification: true`); kritische Vorfälle (Stall, Disconnect, Hardware-Encoder-Fehler) alarmieren mit Ton.
- **Actionable Alerts:** Bei Ausfall der TikTok-Quelle enthält die Warnmeldung direkte Handlungs-Buttons:
  - `[⏸ Pausenscreen halten]`
  - `[⏭ Nächster Streamer]`
  - `[⏹ Stream beenden]`

### 6. Refactoring & Modularisierung
- Aufteilung der 84 KB großen `bot.ts` in modulare Komponenten unter `src/core/telegram/`:
  - `handlers/`: Command-Handler (`status.ts`, `queue.ts`, `media.ts`, `settings.ts`, etc.)
  - `keyboards/`: Wiederverwendbare Inline- und Reply-Keyboard-Builder
  - `views/`: HTML-Nachrichten-Templates und Unicode-Formatierer
  - `api/`: Typisierter Telegram-Bot-API-Client mit Rate-Limit-Handling (429 Retry-After) und Timeout-Absicherung
- Optionale Webhook-Unterstützung (`setWebhook`) für direkte Push-Zustellung über Fastify/Caddy neben dem bestehenden Long-Polling.

## Akzeptanzkriterien

- [ ] Chat-Menü-Button öffnet das RELAY-Dashboard direkt als Telegram Mini App.
- [ ] `/preview` generiert und liefert ein Live-Vorschaubild aus dem laufenden Stream.
- [ ] Regie-Queue, Szenenwechsel und Highlight-Marker sind vollständig über interaktive Inline-Buttons steuerbar.
- [ ] Kritische Benachrichtigungen bieten direkte Ein-Klick-Aktionen zur Fehlerbehebung.
- [ ] `bot.ts` ist in modulare Handler aufgeteilt, wartbar und durch umfassende Unit-/Integrationstests abgesichert.
- [ ] `npm run check` und `npm test` laufen fehlerfrei durch.
