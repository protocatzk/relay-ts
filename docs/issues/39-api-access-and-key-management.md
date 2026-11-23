# Issue 39: API-Zugang konfigurieren und Keys erzeugen und managen

## Übersicht

RELAY bietet eine REST- und SSE-API sowie MCP-Endpunkte, besitzt aktuell jedoch nur ein einzelnes, statisches API-Token über die Umgebungsvariable `API_TOKEN`. 

Für produktive Setups, Automatisierungen, externe Clients (z. B. Stream-Decks, Companion, Regie-Bots, externe Agenten via MCP, Webhooks oder Third-Party-Dashboards) reicht ein statischer Single-Token in der `.env` nicht aus:
1. **Kein Lifecycle-Management:** Tokens können im laufenden Betrieb nicht rotiert, widerrufen oder neu generiert werden, ohne den Prozess neu zu starten und `.env` manuell zu editieren.
2. **Keine Unterscheidbarkeit / Auditierung:** Im Audit-Log (`api:token`) kann nicht nachvollzogen werden, welches Skript oder welcher externe Client eine Aktion ausgeführt hat.
3. **Keine Scopes / Berechtigungsebenen:** Ein Token hat immer Vollzugriff (Admin) – ein Stream-Deck oder Read-Only-Status-Monitor benötigt jedoch meist nur Lesezugriff (`read`) oder spezifische Regie-Befehle (`control:queue`, `control:stream`), aber keinen Zugriff auf Passwörter, YouTube-OAuth-Tokens oder System-Backups.
4. **Fehlende UI:** Im Dashboard gibt es bisher keine Möglichkeit, API-Tokens einzusehen, mit Namen zu versehen, neue Keys mit Ablaufdatum zu erstellen oder abgelaufene/kompromittierte Keys zu sperren.

---

## Anforderungen & Kernfunktionen

### 1. API-Key-Datenmodell & Persistenz
- Speicherung in `data/api-keys.json` (Dateimodus `0600`, atomare Schreibvorgänge via Hilfsmethoden).
- Attribute pro API-Key:
  - `id`: Eindeutige interne ID (`key_<nanoid>`).
  - `name`: Sprechender Name / Einsatzzweck (z. B. "Stream Deck Studio", "Nightbot Webhook", "Home Assistant", "Regie MCP Agent").
  - `key_hash`: Sicherer Hash des API-Keys (z. B. SHA-256 mit Salt oder Scrypt/Argon2); der Klartext-Key wird wie bei GitHub/Stripe nur **einmalig bei Erstellung** angezeigt.
  - `prefix`: Die ersten 8 Zeichen des Keys im Klartext (z. B. `rel_live_...`) zur Identifikation in der Liste.
  - `scopes`: Liste von Berechtigungen (z. B. `*` (Admin), `read:status`, `control:stream`, `control:queue`, `control:overlays`, `manage:streamers`).
  - `created_at`: Erstellungsdatum (ISO-String).
  - `expires_at`: Optionales Ablaufdatum (oder `null` für unbegrenzt).
  - `last_used_at`: Timestamp des letzten erfolgreichen Zugriffs.
  - `last_used_ip`: Letzte anfragende IP-Adresse.
  - `revoked`: Boolean (widerrufen / gesperrt).

### 2. Generierung & Format der Keys
- Standardisiertes, gut erkennbares Präfix: `rel_live_<32_random_bytes_hex_or_base62>` (z. B. `rel_live_9f8a3c...`).
- Erstellung generiert einen kryptografisch sicheren Zufallstoken (`crypto.randomBytes`).
- Rückgabe des vollen Tokens **ausschließlich** im Response-Payload des Create-Aufrufs (`POST /api/api-keys`).

### 3. Authentifizierungs-Middleware & Audit-Integration
- `src/api/auth.ts`: Erweiterung der Token-Prüfung:
  - Zuerst Abgleich gegen gespeicherte aktive API-Keys aus dem Key-Store.
  - Fallback auf statischen `config.apiToken` (für Rückwärtskompatibilität bestehender Scripts/Deployments).
- **Scope-Prüfung:** Middleware prüft bei geschützten Routen, ob der Key den geforderten Scope besitzt (z. B. `read` für `/api/status`, `control:queue` für `/api/queue/play`).
- **Audit-Log:** Anstelle des generischen `api:token` loggt das Audit-System den spezifischen Namen oder das Key-Präfix (z. B. `api:key:Stream Deck Studio`).

### 4. REST-API für Key-Management
- `GET /api/api-keys`: Liste aller angelegten API-Keys (ohne Secret, nur ID, Name, Prefix, Scopes, CreatedAt, ExpiresAt, LastUsedAt, Revoked).
- `POST /api/api-keys`: Neuen API-Key generieren (Payload: `{ name: string, scopes: string[], expires_in_days?: number }`). Liefert `{ key: string, ...details }` zurück.
- `DELETE /api/api-keys/:id` bzw. `POST /api/api-keys/:id/revoke`: Sofortiger Widerruf eines API-Keys.
- Rollenabsicherung: Das Management der API-Keys ist ausschließlich mit vollen Admin-Rechten (Session-Cookie mit Master-Passwort oder Master-Token) möglich.

### 5. Dashboard-UI (Einstellungen -> API-Zugang)
- Neue Sektion / Karte **„API-Zugang & API-Keys"** in der Einstellungs-Ansicht (`SettingsView.vue` oder eigenständige Card `ApiKeySettingsCard.vue`).
- Tabelle aller aktiven und widerrufenen Keys mit:
  - Name und Prefix (`rel_live_abc123...`)
  - Scopes als Badges
  - Letzter Zugriff („vor 5 Minuten von 192.168.1.50“)
  - Status (Aktiv, Abgelaufen, Widerrufen)
  - Aktionen: Key sperren / löschen.
- Dialog „Neuen API-Key erstellen“:
  - Name eingeben
  - Gültigkeitsdauer wählen (7 Tage, 30 Tage, 90 Tage, Unbegrenzt)
  - Scopes auswählen (Vollzugriff, Nur Lesen, Regie-Steuerung)
  - **Einmalige Anzeige des Keys** mit Copy-to-Clipboard-Button und Warnhinweis („Dieser Schlüssel kann später nicht mehr angezeigt werden“).

---

## Akzeptanzkriterien

1. Ein neuer API-Key kann über das Dashboard oder die REST-API erstellt werden; der Plaintext-Key wird nur einmalig ausgegeben.
2. Der Key wird gehasht in `data/api-keys.json` persistiert und überlebt Neustarts.
3. Anfragen mit `Authorization: Bearer rel_live_...` werden autorisiert, `last_used_at` wird aktualisiert.
4. Scope-Restriktionen werden eingehalten (z. B. 403 Forbidden bei Schreiboperationen mit einem Read-Only-Key).
5. Das Audit-Log weist Aktionen dem individuellen Key-Namen zu.
6. Ein widerrufener oder abgelaufener Key wird sofort mit 401 Unauthorized abgelehnt.
7. Der bestehende Legacy-`API_TOKEN` aus `.env` funktioniert weiterhin als Master-Fallback.
