## Ziel

Einnahmen nicht nur als Momentaufnahme, sondern als Verlauf und mit schneller
Zeitraumwahl darstellen.

## Umfang

- Lokale Historie (z. B. `data/earnings-history.json` oder SQLite).
- Charts für Netto/Brutto/Coins über Zeit.
- Delta zum Vortag/letzten Zeitraum.
- Zeitraum-Schnellwahl direkt im Dashboard (`today`, `24h`, `7d`, `30d`, `all`).
- „Stale“-Anzeige mit Datenalter.
- Aufschlüsselung nach Gift-Typen/Top-Spendern, falls die Quelle sie liefert.
- Aufbewahrungslimit und Datenschutz beachten.

## Akzeptanzkriterien

- [ ] Historische Werte überleben Neustarts.
- [ ] Zeitraum ist im Dashboard ohne Einstellungswechsel änderbar.
- [ ] Datenalter und Fehlerzustand sind sichtbar.
- [ ] Parser- und Historien-Tests sind vorhanden.
