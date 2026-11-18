# Telegram-Bot

Der Bot läuft per Long-Polling im selben Prozess wie RELAY. Er akzeptiert
ausschließlich private Chats von numerischen IDs aus
`TELEGRAM_ALLOWED_USER_IDS` (fail-closed). Bot-Token und Stream-Keys werden nie
gesendet oder geloggt.

## Befehle

| Befehl | Beschreibung |
| --- | --- |
| `/start` | Login-Anfrage freigeben bzw. Übersicht |
| `/id` | Eigene Telegram-ID |
| `/menu` | Inline-Menü mit allen Bereichen |
| `/status` | State, Streamer, Playlist, Quelle, Sink, Uptime |
| `/streamers` | Streamer-Liste mit Start-Buttons |
| `/go <id>` | Streamer direkt starten/wechseln |
| `/stop` | Stream beenden (mit Bestätigung) |
| `/next` / `/prev` | Playlist vor/zurück |
| `/pause` | Pausenscreen an/aus |
| `/screens` | Pause- und Startbildschirm ein-/ausschalten |
| `/overlays` | Chat, Uhr und Text einzeln umschalten |
| `/settings` | Wichtige Einstellungen (read-only) |
| `/earnings [today\|24h\|7d\|30d\|all]` | Einnahmen + Zeitraum-Buttons |
| `/youtube` | Broadcasts mit Live/Ende/Öffentlich-Aktionen |
| `/sessions` | Dashboard-Sessions, einzelne oder alle trennen |
| `/media` | Lokale Videos in `data/media` |
| `/logs [n]` | Letzte Logzeilen |
| `/notify [on\|off\|live\|reconnect\|error]` | Benachrichtigungen |

`/stop`, Session-Widerruf und YouTube-Aktionen verlangen eine Bestätigung über
Inline-Buttons. Der Nonce ist 60 Sekunden gültig, einmalig und an Chat + User
gebunden; weitergeleitete Nachrichten können die Aktion nicht auslösen.

## Paritätsmatrix

| Webapp | Bot | Status |
| --- | --- | --- |
| Dashboard-Status | `/status` | vollständig |
| Live-Vorschau | Dashboard-Link | eingeschränkt (kein Video in Telegram) |
| Streamer starten/wechseln | `/streamers`, `/go` | vollständig |
| Streamer anlegen/bearbeiten/löschen | – | offen |
| Streamer aktivieren/deaktivieren | – | offen |
| Playlist starten/next/prev | `/next`, `/prev` | teilweise (Start über Streamer) |
| Playlist anlegen/bearbeiten | – | offen |
| Kanäle hinzufügen/entfernen | – | offen |
| Pause/Startbildschirm | `/screens`, `/pause` | vollständig |
| Overlays an/aus | `/overlays` | eingeschränkt (keine Position/Stil) |
| Overlay-Studio | – | bewusst nicht im Bot |
| Einnahmen + Zeitraum | `/earnings` | vollständig (Kurzfassung) |
| Einstellungen ändern | – | offen (nur Ansicht) |
| Logs | `/logs` | teilweise (Level/Suche/Seiten offen) |
| Sessions | `/sessions` | vollständig inkl. Bestätigung |
| Medienliste | `/media` | vollständig (kein Löschen) |
| Medien löschen | – | offen |
| YouTube-Broadcasts | `/youtube` | teilweise (Liste, Live, Ende, Publish) |
| YouTube anlegen/planen | – | offen |
| YouTube-Ingest zuordnen | – | offen |
| Benachrichtigungen | `/notify` | vollständig |

## Sicherheit

- Allow-List bleibt fail-closed; unbefugte IDs werden ignoriert und geloggt.
- Callback-Daten sind auf 64 Byte begrenzt und enthalten nur IDs/Nonces.
- Bestätigungen sind einmalig, 60 s gültig und an Chat + User gebunden.
- Keine Secrets, Stream-Keys oder Tokens in Nachrichten.
- Streamer-/Playlist-IDs werden vor der Ausführung über den Control-Layer
  aufgelöst; ungültige IDs führen zu einer Fehlermeldung statt zu einem Absturz.

## Nächste Schritte

1. Streamer anlegen/bearbeiten mit geführten Dialogen.
2. Playlist-Verwaltung inklusive Kanäle und lokaler Videos.
3. Einstellungen mit Whitelist änderbarer Felder.
4. Log-Filter (Level/Suche) und Seitenblättern.
5. Medien löschen und YouTube-Broadcast anlegen/planen.
