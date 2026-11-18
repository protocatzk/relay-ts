## Ziel

Mobile Bedienung und Accessibility belastbar machen und automatisiert prüfen.

## Umfang

- Fokus-Falle und Esc-Handling im Drawer.
- Korrekte `aria-*`-Attribute, sichtbare Fokuszustände, Screenreader-Tests.
- Tabellen-Karten mit sinnvollen Labels und Rollen.
- Mobile E2E-Tests (z. B. Playwright) für Login, Navigation, Settings,
  Overlay-Studio und Pause-Einstellungen.
- Prüfung auf horizontalen Overflow bei 320/360/390 px.
- Kontrastprüfung im Dark- und Light-Theme.

## Akzeptanzkriterien

- [ ] Alle Kernseiten sind bei 320 px ohne horizontales Scrollen bedienbar.
- [ ] Drawer gibt den Fokus beim Schließen korrekt zurück.
- [ ] E2E-Smoke-Tests laufen in CI.
- [ ] Kontrast und Fokus sind dokumentiert geprüft.
