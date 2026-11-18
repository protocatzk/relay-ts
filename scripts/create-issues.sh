#!/usr/bin/env bash
#
# Erstellt die GitHub-Issues aus docs/issues/manifest.jsonl.
#
# Voraussetzungen:
#   - GitHub CLI (gh) installiert und authentifiziert: gh auth login
#   - Schreibrechte im Repository
#
# Verwendung:
#   ./scripts/create-issues.sh
#   ./scripts/create-issues.sh --dry-run
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/docs/issues/manifest.jsonl"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) fehlt. Installieren: https://cli.github.com/" >&2
  exit 1
}

gh auth status >/dev/null 2>&1 || {
  echo "GitHub CLI ist nicht authentifiziert. Bitte 'gh auth login' ausführen." >&2
  exit 1
}

[[ -f "$MANIFEST" ]] || {
  echo "Manifest nicht gefunden: $MANIFEST" >&2
  exit 1
}

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
echo "Repository: $REPO"

label_color() {
  case "$1" in
    security) echo "d73a4a" ;;
    reliability) echo "fbca04" ;;
    testing) echo "1d76db" ;;
    overlay) echo "a371f7" ;;
    pause) echo "3fb950" ;;
    earnings) echo "0e8a16" ;;
    telegram) echo "229ed9" ;;
    mobile) echo "c5def5" ;;
    accessibility) echo "bfd4f2" ;;
    ops|observability) echo "d4c5f9" ;;
    tech-debt) echo "8a97a8" ;;
    api) echo "5319e7" ;;
    P0) echo "b60205" ;;
    P1) echo "d93f0b" ;;
    P2) echo "fbca04" ;;
    P3) echo "0e8a16" ;;
    P4) echo "cfd3d7" ;;
    *) echo "ededed" ;;
  esac
}

ensure_label() {
  local label="$1"
  [[ -z "$label" ]] && return
  gh label create "$label" --color "$(label_color "$label")" --description "RELAY Roadmap" 2>/dev/null || true
}

ensure_milestone() {
  local title="$1"
  [[ -z "$title" ]] && return
  if ! gh api "repos/$REPO/milestones?state=all" --jq '.[].title' | grep -Fxq "$title"; then
    gh api -X POST "repos/$REPO/milestones" -f title="$title" >/dev/null
    echo "Meilenstein angelegt: $title"
  fi
}

issue_exists() {
  local title="$1"
  gh issue list --repo "$REPO" --state all --limit 200 --json title --jq '.[].title' | grep -Fxq "$title"
}

created=0
skipped=0

while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  title="$(jq -r '.title' <<<"$row")"
  file="$(jq -r '.file' <<<"$row")"
  milestone="$(jq -r '.milestone // empty' <<<"$row")"
  mapfile -t labels < <(jq -r '.labels[]?' <<<"$row")

  if issue_exists "$title"; then
    echo "SKIP  $title"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY   $title  [${labels[*]}]  $milestone"
    continue
  fi

  for label in "${labels[@]}"; do ensure_label "$label"; done
  [[ -n "$milestone" ]] && ensure_milestone "$milestone"

  label_args=()
  for label in "${labels[@]}"; do label_args+=(--label "$label"); done

  gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --body-file "$ROOT/docs/issues/$file" \
    "${label_args[@]}" \
    ${milestone:+--milestone "$milestone"}
  created=$((created + 1))
done < "$MANIFEST"

echo
echo "Fertig: $created erstellt, $skipped übersprungen."
