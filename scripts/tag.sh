#!/usr/bin/env bash
#
# RELAY – Release-Version bumpen, prüfen, committen und taggen.
#
# Aktualisiert package.json, package-lock.json, src/version.ts und
# docs/openapi.json, führt npm run check && npm run build aus, erstellt einen
# Release-Commit sowie einen annotierten Git-Tag v<version> und pusht optional.
#
# Verwendung:
#   ./scripts/tag.sh 0.21.0
#   ./scripts/tag.sh patch --push
#   ./scripts/tag.sh minor --dry-run
#
# Optionen:
#   --push      Branch und neuen Tag nach origin pushen
#   --no-check  npm run check && npm run build überspringen
#   --dry-run   Nur Vorschau ausgeben, nichts ändern
#   -h, --help  Hilfe anzeigen
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;32m[tag]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[tag]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[tag]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

TARGET=""
PUSH=0
RUN_CHECK=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --no-check) RUN_CHECK=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) fail "Unbekannte Option: $arg" ;;
    *)
      [[ -z "$TARGET" ]] || fail "Zu viele Argumente: $arg"
      TARGET="$arg"
      ;;
  esac
done

[[ -n "$TARGET" ]] || { usage >&2; exit 1; }

TARGET="${TARGET#v}"
if [[ ! "$TARGET" =~ ^(patch|minor|major|[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
  fail "Ungültige Version: $TARGET (erwartet z. B. 0.21.0, patch, minor, major)"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  fail "Arbeitsverzeichnis ist nicht sauber. Bitte zuerst committen oder stashen."
fi

CURRENT_VERSION="$(node -p "require('./package.json').version")"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

resolve_next_version() {
  node -e "
    const cur = process.argv[1];
    const target = process.argv[2];
    if (/^\d+\.\d+\.\d+/.test(target)) { console.log(target); process.exit(0); }
    const [maj, min, pat] = cur.split('-')[0].split('.').map(Number);
    if (target === 'major') console.log((maj + 1) + '.0.0');
    else if (target === 'minor') console.log(maj + '.' + (min + 1) + '.0');
    else if (target === 'patch') console.log(maj + '.' + min + '.' + (pat + 1));
  " "$CURRENT_VERSION" "$TARGET"
}

NEXT_VERSION="$(resolve_next_version)"
TAG="v$NEXT_VERSION"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  fail "Tag $TAG existiert bereits."
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "DRY-RUN: $CURRENT_VERSION -> $NEXT_VERSION (Tag $TAG auf Branch $BRANCH)"
  log "DRY-RUN: Dateien: package.json, package-lock.json, src/version.ts, docs/openapi.json"
  [[ "$RUN_CHECK" -eq 1 ]] && log "DRY-RUN: würde 'npm run check && npm run build' ausführen"
  [[ "$PUSH" -eq 1 ]] && log "DRY-RUN: würde 'git push origin $BRANCH $TAG' ausführen"
  exit 0
fi

log "Version bumpen: $CURRENT_VERSION -> $NEXT_VERSION"
npm version "$NEXT_VERSION" --no-git-tag-version >/dev/null

printf "export const VERSION = '%s';\n" "$NEXT_VERSION" > "$ROOT/src/version.ts"

log "AGENTS.md-Versionsangabe aktualisieren"
if grep -qE '^- Aktuelle Version: \*\*[0-9]+\.[0-9]+\.[0-9]+\*\*$' AGENTS.md; then
  sed -i -E "s/^- Aktuelle Version: \*\*[0-9]+\.[0-9]+\.[0-9]+\*\*\$/- Aktuelle Version: **$NEXT_VERSION**/" AGENTS.md
fi

log "OpenAPI-Spezifikation aktualisieren"
npm run openapi:generate >/dev/null

if [[ "$RUN_CHECK" -eq 1 ]]; then
  log "Prüfungen & Build ausführen (npm run check && npm run build)"
  npm run check
  npm run build
else
  warn "Prüfungen übersprungen (--no-check)"
fi

git_identity_args=()
if ! git config user.name >/dev/null 2>&1 || ! git config user.email >/dev/null 2>&1; then
  git_identity_args=(-c user.name="Restreamer TS" -c user.email="restreamer-ts@localhost")
fi

git add package.json package-lock.json src/version.ts docs/openapi.json
git "${git_identity_args[@]}" commit -m "chore: release $TAG"
git "${git_identity_args[@]}" tag -a "$TAG" -m "Release $TAG"

log "Erstellt: Commit $(git rev-parse --short HEAD) + Tag $TAG"

if [[ "$PUSH" -eq 1 ]]; then
  log "Pushe $BRANCH und $TAG nach origin"
  git push origin "$BRANCH" "$TAG"
else
  log "Nächster Schritt: git push origin $BRANCH $TAG"
fi
