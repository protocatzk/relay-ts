# Issue 41: API-Key-Store asynchron und gedrosselt persistieren

## Ziel

Der `ApiKeyStore` schreibt bei **jedem authentifizierten API-Request** synchron auf die Platte, um `last_used_at`/`last_used_ip` zu aktualisieren. Das blockiert den Event-Loop und verletzt die eigene Invariante aus `AGENTS.md`: „Recordings-API und Audit-Log laufen vollständig asynchron über Promises".

## Hintergrund

- `src/api/api-key-store.ts` ruft `persist()` in `authenticate()` bei jedem Treffer auf.
- `persist()` nutzt `writeJsonFile` → `writeFileAtomic` (`src/utils/fs.ts`), das `writeFileSync` + `renameSync` verwendet: zwei Sync-Syscalls plus Rename pro Request im Node.js-Event-Loop.
- Bei Token-basierten Automatisierungen (Stream-Deck, MCP, Monitoring, das sekündlich pollt) entsteht damit eine unnötige Write-Amplification inkl. nuevos `api-keys.json.tmp-*`-Files und Rename-Churn.
- Gleiches Muster betrifft potenziell weitere Store-Plus-Request-Fälle; der Fix sollte exemplarisch den Request-Hot-Path auflösen.

## Umfang

- `last_used_at`/`last_used_ip` nur im Speicher aktualisieren und die Persistenz drosseln:
  - Variante A: max. einmal pro Minute (oder N Requests) schreiben, plus Flush bei `process.exit`/SIGTERM im Shutdown-Pfad.
  - Variante B: debounce-basiertes Schreiben (kurz nach dem letzten Treffer).
- Zusätzlich: `writeFileAtomic`/`writeJsonFile` als async-Variante (`fs/promises`) ergänzen und im Api-Key-Store verwenden; der Request-Path soll keinen Sync-I/O mehr enthalten.
- Tests: letzter Schreibzeitpunkt wird gedrosselt; geladene Datei enthält nach Flush die aktualisierte Nutzung.

## Akzeptanzkriterien

- [ ] Ein authentifizierter API-Request verursacht keinen synchronen Platten-Write mehr (Drossel greift).
- [ ] Nach dem letzten Request wird der Nutzungsstand persistiert (auch bei Shutdown).
- [ ] `data/api-keys.json` bleibt atomar (0600) geschrieben und überlebt Neustarts mit korrektem Stand.
- [ ] `npm run check` grün; neue Tests decken die Drosselung ab.
