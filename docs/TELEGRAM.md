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
| `/streamers` | Streamer-Liste, anlegen/bearbeiten/löschen, aktivieren, Qualität |
| `/playlists` | Playlists, Kanäle/Videos, Auto-Advance, Start/Löschen |
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
| Streamer anlegen/bearbeiten/löschen | `/streamers` | vollständig (Name, Handle, Qualität, Enabled) |
| Streamer aktivieren/deaktivieren | `/streamers` | vollständig |
| Playlist starten/next/prev | `/playlists`, `/next`, `/prev` | vollständig |
| Playlist anlegen/bearbeiten | `/playlists` | vollständig (Name, Auto-Advance, Wrap) |
| Kanäle/Videos hinzufügen/entfernen | `/playlists` | vollständig (Handle oder `data/media`) |
| Pause/Startbildschirm | `/screens`, `/pause` | vollständig |
| Overlays an/aus | `/overlays` | eingeschränkt (keine Position/Stil) |
| Overlay-Studio | – | bewusst nicht im Bot |
| Einnahmen + Zeitraum | `/earnings` | vollständig (Kurzfassung) |
| Einstellungen ändern | `/settings` | teilweise (Delay, Pause, Startup, Auto-Refresh, Schalter) |
| Logs | `/logs` | vollständig (Level, Suche, Seiten) |
| Sessions | `/sessions` | vollständig inkl. Bestätigung |
| Medienliste | `/media` | vollständig (kein Löschen) |
| Medien löschen | `/media` | vollständig (mit Bestätigung) |
| YouTube-Broadcasts | `/youtube` | vollständig für Liste, Live, Ende, Publish, Ingest |
| YouTube anlegen/planen | `/youtube` | eingeschränkt (Titel, Startzeit, Sichtbarkeit, Streamer) |
| YouTube-Ingest zuordnen | `/youtube` | vollständig |
| Benachrichtigungen | `/notify` | vollständig |

## Sicherheit

- Allow-List bleibt fail-closed; unbefugte IDs werden ignoriert und geloggt.
- Callback-Daten sind auf 64 Byte begrenzt und enthalten nur IDs/Nonces.
- Bestätigungen sind einmalig, 60 s gültig und an Chat + User gebunden.
- Keine Secrets, Stream-Keys oder Tokens in Nachrichten.
- Streamer-/Playlist-IDs werden vor der Ausführung über den Control-Layer
  aufgelöst; ungültige IDs führen zu einer Fehlermeldung statt zu einem Absturz.

## Inline-Menü und Eingaben

Alle Bereiche sind über Inline-Buttons erreichbar (`/menu`). Mehrstufige
Eingaben laufen als geführte Dialoge (5 Minuten gültig, pro Chat/User):

- Streamer anlegen: ID → Name → Handle
- Playlist anlegen: ID → Name
- Kanal/Video hinzufügen: Handle oder Dateiname
- Einstellungen: Zahl senden (Delay, Pause, Startup, Refresh)
- Log-Suche: Suchbegriff senden
- YouTube-Broadcast: Titel → Startzeit (`ISO` oder `+30`) → Sichtbarkeit → Ingest

Jeder Schritt kann mit `abbrechen` beendet werden. Lange IDs werden intern auf
kurze Refs abgebildet, damit `callback_data` unter 64 Byte bleibt.

## Bewusst nicht im Bot

- Vollständiges Overlay-Studio (Drag/Resize, Presets).
- Komplette YouTube-Metadaten (Kategorie, Thumbnail, Beschreibung, DVR).
- Playlist-Endzeit/Dauer und Playlist-Key.
- Streamer-YouTube-Key setzen (nur Status anzeigen).
