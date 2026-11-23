# Issue 44: Versionsangabe in AGENTS.md aktualisieren

## Ziel

`AGENTS.md` nennt als „Aktuelle Version" noch **0.30.4**, während `package.json`/`src/version.ts` bei **0.31.7** stehen. Die Angabe ist für Agenten und Entwickler die Referenz und soll die Release-Historie nicht fälschlich veralten lassen.

## Hintergrund

- Zwei Releaseschritte (0.31.x) haben die manuelle Angabe in `AGENTS.md` nicht aktualisiert.
- Optionen:
  - a) Angabe entfernen (die Version steht kanonisch in `package.json`, `src/version.ts` und `/api/status` – eine zweite Quelle ist fehleranfällig).
  - b) Angabe automatisiert beim Release aktualisieren (z. B. in `scripts/tag.sh` eine sed-Ersetzung).

## Umfang

- Entscheidung zwischen Entfernen und Automatisierung, dann Umsetzung in `AGENTS.md` bzw. `scripts/tag.sh`.

## Akzeptanzkriterien

- [ ] `AGENTS.md` widerspricht `package.json` nicht mehr (entweder entfernt oder korrekt befüllt und beim Release automatisiert).
