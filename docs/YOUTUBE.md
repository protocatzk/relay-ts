# YouTube-Verwaltung

RELAY verbindet sich über OAuth 2.0 mit **einem** YouTube-Konto. Die Verbindung
wird für die spätere Broadcast-Verwaltung (#18) genutzt; aktuell umfasst sie den
Login, automatische Token-Erneuerung und das Trennen der Verbindung.

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
- Keine YouTube-Analytics oder Chat-Moderation.
- Broadcast-Erstellung und -Planung folgen im weiteren Verlauf von #18.
