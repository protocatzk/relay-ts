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

## Manuell

1. Datei öffnen,
2. Titel aus `manifest.jsonl` übernehmen,
3. Inhalt als Issue-Body einfügen,
4. Labels und Meilenstein setzen.
