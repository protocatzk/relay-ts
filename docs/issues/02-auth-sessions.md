## Ziel

Auth-Sessions serverseitig verwalten, damit einzelne Sitzungen ablaufen und
widerrufen werden können.

## Ausgangslage

Das aktuelle Cookie ist ein signiertes `ok` ohne Benutzeridentität oder
serverseitigen Zustand. Logout löscht nur das Cookie im Browser.

## Umfang

- Session-Store mit ID, Benutzer, Erstellungszeit, letzter Aktivität und Ablauf.
- Cookie enthält nur die signierte Session-ID.
- Sessions für Passwort-, Basic- und Telegram-Login.
- Ablauf und „alle Sitzungen abmelden“.
- Optional: Liste aktiver Sessions im Dashboard.
- Cleanup abgelaufener Sessions im Speicher und bei Neustart definiert
  dokumentieren.

## Akzeptanzkriterien

- [ ] Login erzeugt eine serverseitige Session mit Benutzerkennung.
- [ ] Logout invalidiert die Session serverseitig.
- [ ] Abgelaufene Sessions werden abgelehnt und aufgeräumt.
- [ ] „Alle abmelden“ beendet alle aktiven Sessions.
- [ ] Bestehende Cookie-/Telegram-Tests bleiben grün.
