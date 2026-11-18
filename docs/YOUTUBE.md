# YouTube-Verwaltung

RELAY verbindet sich über OAuth 2.0 mit **einem** YouTube-Konto. Die Verbindung
wird für die Broadcast-Verwaltung (#18) genutzt: Login, automatische
Token-Erneuerung, Trennen sowie eine Übersicht der geplanten, laufenden und
beendeten Broadcasts inklusive Ingest-Health.

## Google-Cloud-Projekt einrichten

1. Projekt anlegen: https://console.cloud.google.com/projectcreate
2. **YouTube Data API v3** aktivieren:
   https://console.cloud.google.com/apis/library/youtube.googleapis.com
3. **Google Auth Platform** öffnen: https://console.cloud.google.com/auth/overview
   - Branding: App-Name `RELAY`, Support-E-Mail
   - Audience: `External` (oder `Internal` mit Google Workspace)
   - Data Access: `https://www.googleapis.com/auth/youtube.force-ssl`
4. **OAuth-Client** erstellen: https://console.cloud.google.com/apis/credentials
   - Typ: **Webanwendung**
   - Autorisierte Weiterleitungs-URI (exakt):
     `https://relay.positronium.dev/api/youtube/oauth/callback`
   - Lokal zusätzlich: `http://localhost:3000/api/youtube/oauth/callback`
5. Client-ID und Clientschlüssel in `.env` eintragen:

```bash
GOOGLE_CLIENT_ID=123456789012-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=https://relay.positronium.dev/api/youtube/oauth/callback
```

6. Container neu starten: `docker compose up -d`
7. Im Dashboard **YouTube → Konto verbinden** wählen und die Zustimmung erteilen.

Ohne `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` bleibt die Funktion
deaktiviert; das Dashboard zeigt dann einen Konfigurationshinweis.

## Publishing-Status

| Konfiguration | Refresh-Token |
| --- | --- |
| External + `Testing` | läuft nach **7 Tagen** ab |
| External + `In production` | kein 7-Tage-Ablauf, Warnung „nicht verifiziert“, 100-Nutzer-Cap |
| `Internal` (Workspace) | kein Ablauf, keine Verifizierung |

Für Dauerbetrieb muss die App **In production** sein oder `Internal` genutzt
werden. Nach dem Umschalten kann es einige Stunden dauern, bis der
Zustimmungsbildschirm den neuen Status übernimmt.

## Scopes und Quota

- Scope: `https://www.googleapis.com/auth/youtube.force-ssl`
  (Broadcasts, Streams, Statusübergänge, Thumbnails)
- Standardquota: **10.000 Units/Tag** pro Projekt
- Grobe Kosten: `liveBroadcasts.insert`, `liveStreams.insert`, `update`,
  `transition`, Thumbnail-Upload je ca. 50 Units; Listen je 1 Unit.

## Automatik und Overrides

Die Automation ist bewusst in Schichten aufgebaut, damit sie ohne Codeänderung
abgeschaltet oder je Broadcast angepasst werden kann:

```text
Defaults → config/settings.yml → .env (nur mit SETTINGS_ENV_OVERRIDES=true)
        → Request-Override beim Anlegen/Ändern
```

`config/settings.yml`:

```yaml
youtube:
  auto_transition: true   # Hauptschalter für Start/Stop-Automatik
  auto_mode: relay_only   # off | relay_only | all
  auto_start: true        # Broadcast beim Stream-Start live schalten
  auto_stop: true         # Broadcast beim vollständigen Stop beenden
  default_privacy: unlisted
  default_dvr: true
```

Entsprechende Umgebungsvariablen: `YOUTUBE_AUTO_TRANSITION`,
`YOUTUBE_AUTO_MODE`, `YOUTUBE_AUTO_START`, `YOUTUBE_AUTO_STOP`,
`YOUTUBE_DEFAULT_PRIVACY`, `YOUTUBE_DEFAULT_DVR`.

**Pro Broadcast** überschreibt ein Request die Defaults: `privacy` und
`enable_dvr` beim Anlegen/Ändern gelten nur für diesen Broadcast.
`POST …/publish`, `…/transition` und `…/assign` sind explizite Einzelaktionen
und ignorieren die Automatik vollständig.

Die Auswahl logik liegt in `src/core/youtube/automation.ts` und akzeptiert
zusätzlich einen Override-Resolver pro Broadcast-ID. Damit lässt sich später
eine lokale Ausnahme-Datei ergänzen, ohne die Automatik umzubauen.

## Broadcasts anlegen und planen

- **Anlegen** bindet den Broadcast immer an den RELAY-Ingest: aktiver
  Streamer, sonst bevorzugter, sonst erster aktivierter mit Key. Ein neuer
  YouTube-Ingest wird nicht mehr still erzeugt. Fehlt ein Key, schlägt das
  Anlegen mit einer klaren Meldung fehl; der Key wird nie übertragen oder
  angezeigt.
- **Sichtbarkeit** ist standardmäßig `unlisted`. Ein späteres
  **Veröffentlichen** setzt `privacyStatus=public` mit einem einzigen
  `liveBroadcasts.update` – ca. 50 Quota-Einheiten, kein Polling.
- **Auto-Transition:** RELAY verwaltet nur Broadcasts, die es selbst angelegt
  hat (`data/youtube-broadcasts.json`), und nur innerhalb von ±30 Minuten um
  die geplante Startzeit. Der Hook läuft erst, wenn der Sink tatsächlich
  sendet, nicht beim Quellenstart. Beim vollständigen Stop wird nur der
  RELAY-Broadcast beendet; Studio-/Quick-Live-Broadcasts bleiben unberührt.
  Pausenscreen und Streamerwechsel mit gleichem Key beenden nichts. Der Hook
  ist best-effort und beeinflusst den Stream nie; `auto_mode` steuert
  `off`, `relay_only` (Default) oder `all`.
- **Titel** kommt beim Anlegen aus dem Formular (oder aus
  `YOUTUBE_TITLE_TEMPLATE` im Dashboard); Änderungen laufen über
  `PUT /api/youtube/broadcasts/:id`.

### Quota-Kosten (ca.)

| Aktion | Units |
| --- | --- |
| Broadcast anlegen (`insert`) | 50 |
| Ingest anlegen (`liveStreams.insert`) | 50 |
| Binden (`bind`) | 50 |
| Statuswechsel (`transition`) | 50 |
| Aktualisieren / Veröffentlichen | 50 |
| Listen (`list`) | 1 |

Bei 10.000 Units/Tag sind das ca. 60–70 vollständige Anlege-Vorgänge pro Tag.
Die Broadcast-Liste wird 20 s gecacht.

## Tokenablage

- Datei: `data/youtube-auth.json`, Modus `0600`
- Klartext (kein AES), damit ein Wechsel von `SESSION_SECRET` die Verbindung
  nicht zerstört
- Enthält Access-Token, Refresh-Token, Ablaufzeit, Scope und Kanalname
- Tokens werden **nie** über die API ausgeliefert oder geloggt
- Beim Trennen wird der Token bei Google widerrufen und die Datei gelöscht
- `data/` ist aus Git ausgeschlossen; Backups enthalten die Datei, solange sie
  nicht explizit ausgenommen wird

## Verhalten

- Access-Tokens werden 60 s vor Ablauf automatisch erneuert.
- Antwortet Google mit `invalid_grant`, gilt die Verbindung als abgelaufen: die
  Datei wird gelöscht und das Dashboard verlangt ein erneutes Verbinden.
- Der OAuth-Flow nutzt State + PKCE (S256); der State ist einmalig und 10
  Minuten gültig. Der Callback ist der einzige unauthentifizierte API-Endpunkt.
- Es wird immer `prompt=consent` angefordert, damit Google zuverlässig einen
  Refresh-Token ausstellt.

## API

| Methode | Endpunkt | Beschreibung |
| --- | --- | --- |
| `GET` | `/api/youtube/status` | Verbindungsstatus ohne Tokens |
| `GET` | `/api/youtube/broadcasts` | Broadcasts inkl. Status und Ingest-Health |
| `POST` | `/api/youtube/broadcasts` | Broadcast anlegen und binden |
| `PUT` | `/api/youtube/broadcasts/:id` | Titel, Beschreibung, Zeit, Sichtbarkeit |
| `POST` | `/api/youtube/broadcasts/:id/publish` | Sichtbarkeit auf `public` setzen |
| `POST` | `/api/youtube/broadcasts/:id/transition` | `testing`, `live`, `complete` |
| `POST` | `/api/youtube/broadcasts/:id/assign` | Ingest eines Streamers binden |
| `DELETE` | `/api/youtube/broadcasts/:id` | Broadcast löschen |
| `GET` | `/api/youtube/oauth/start` | `{ url }` für die Google-Zustimmung |
| `GET` | `/api/youtube/oauth/callback` | Google-Redirect; State + PKCE, ohne Session |
| `POST` | `/api/youtube/oauth/disconnect` | Token widerrufen und Verbindung löschen |

## Fehlerbehebung

- **`redirect_uri_mismatch`**: URI im OAuth-Client stimmt nicht exakt mit
  `GOOGLE_REDIRECT_URI` überein (kein trailing slash, `https`).
- **`invalid_client`**: Client-ID/Secret falsch oder aus einem anderen Projekt.
- **`invalid_grant` nach ca. 7 Tagen**: App steht noch auf `Testing`; auf
  `In production` umstellen und neu verbinden.
- **`quotaExceeded`**: Tageslimit erreicht; Retry-Loops vermeiden.
- **Kanalname leer**: Konto hat keinen YouTube-Kanal oder `channels.list` wurde
  abgelehnt; die Verbindung bleibt trotzdem gültig.

## Grenzen

- Ein Konto pro RELAY-Instanz; keine Multi-Account-Verwaltung.
- Broadcast-Liste ist auf eine Seite (50 Einträge) begrenzt.
- Ingest-Keys aus `liveStreams.cdn` werden bewusst verworfen und nie ausgeliefert.
- Keine YouTube-Analytics oder Chat-Moderation.
- Anlegen, Planen und Starten von Broadcasts folgt im nächsten Schritt von #18.
