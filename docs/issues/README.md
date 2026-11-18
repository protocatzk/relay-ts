# Issue-Entwürfe

Hier liegen die Issue-Texte für die [Roadmap](../ROADMAP.md). Die Dateien sind
GitHub-Issue-Bodies und können direkt in ein Issue kopiert werden.

## Import per GitHub CLI

```bash
gh auth login
./scripts/create-issues.sh --dry-run   # Vorschau
./scripts/create-issues.sh             # Issues anlegen
```

Das Script liest `manifest.jsonl`, legt fehlende Labels/Meilensteine an und
überspringt Issues, deren Titel bereits existiert.

## Automatisch per GitHub Action

Der Workflow `.github/workflows/create-roadmap-issues.yml` startet bei
Änderungen an `docs/issues/**` oder manuell über **Actions → Create roadmap
issues → Run workflow**. Er nutzt das eingebaute `GITHUB_TOKEN` mit
`issues: write` und ist idempotent: bereits existierende Titel werden
übersprungen.

SSH-Zugriff allein reicht für die GitHub-API nicht aus; der Workflow umgeht das,
weil GitHub Actions das Repository-Token bereitstellt.

## Manuell

1. Datei öffnen,
2. Titel aus `manifest.jsonl` übernehmen,
3. Inhalt als Issue-Body einfügen,
4. Labels und Meilenstein setzen.
