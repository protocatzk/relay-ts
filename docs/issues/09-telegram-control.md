## Ziel

Den Telegram-Bot von Login-Freigaben zu einer vollwertigen Steuerungs- und
Benachrichtigungszentrale ausbauen.

## Umfang

- Befehle/Buttons für Status, Start/Stop, Senderwechsel, Playlist
  weiter/zurück und Log-Auszug.
- Benachrichtigungen bei LIVE/offline, Reconnect, Pause-Timeout und Fehlern.
- Session-Liste im Dashboard und „alle Sessions abmelden“.
- Allow-List bleibt fail-closed; keine Gruppen-Chats.
- Bot-Token weiterhin niemals loggen.
- Tests mit gemockter Telegram-API.

## Akzeptanzkriterien

- [ ] Status und Streamersteuerung funktionieren über Buttons/Befehle.
- [ ] Benachrichtigungen lassen sich getrennt aktivieren/deaktivieren.
- [ ] Unautorisierte IDs werden ignoriert und geloggt.
- [ ] Bestehender Login-Flow bleibt kompatibel.
