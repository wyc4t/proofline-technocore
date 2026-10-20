#!/usr/bin/env bash
# One capture of the evidence archive, as run by .github/workflows/archive.yml from the
# workspace root (code/ = this repository, data/ = the archive-data branch).
#
# Release files wait in data/pending-uploads until uploaded. Only files whose name and hash
# match a manifest entry are published. Upload happens before the commit: if it fails, the
# script stops without committing, the cursor does not move, and the next capture fetches
# the same records again.
set -euo pipefail

node code/archive/collect.mjs --data data --outbox data/pending-uploads \
  --rooms credence,kibble,d-proofline --release-rooms kibble

node code/archive/pending.mjs --data data > pending.tsv
while IFS=$'\t' read -r tag file; do
  if ! gh release view "$tag" -R "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
    gh release create "$tag" -R "$GITHUB_REPOSITORY" --target archive-data --latest=false \
      --title "Evidence archive: $tag" \
      --notes "Raw Technocore records, byte for byte as exported, captured by the Proofline evidence archive. Each file's sequence range and SHA-256 are recorded in captures.jsonl on the archive-data branch. To check: see archive/README.md on main."
  fi
  gh release upload "$tag" "$file" -R "$GITHUB_REPOSITORY" --clobber
  rm "$file"
done < pending.tsv
find data/pending-uploads -type d -empty -delete 2>/dev/null || true

# Reproduction: re-run the read-only GET requests that new credence results and attestations report,
# within the half hour, and store Proofline's own observations in data/reproductions/. Only allowlisted
# read paths are ever requested (src/lib/claims.js). A failure never blocks the capture.
node code/archive/reproduce.mjs --data data --new || echo "reproduction skipped this time"

# Hourly: recompute the headline statistics (stats/latest.json) from the archive. A failure
# here never blocks the capture itself: a missing file makes the statistics say they are
# incomplete, and a failed calculation keeps the previous statistics file.
if node -e 'try{const s=JSON.parse(require("fs").readFileSync("data/stats/latest.json"));process.exit(Date.now()-Date.parse(s.generated_at)>55*60e3?0:1)}catch{process.exit(0)}'; then
  (
    mkdir -p assets
    node code/archive/stats.mjs --data data --list-assets > needed.tsv
    while IFS=$'\t' read -r tag asset; do
      [ -z "$asset" ] || [ -f "assets/$asset" ] || gh release download "$tag" -R "$GITHUB_REPOSITORY" -p "$asset" -D assets
    done < needed.tsv
    node code/archive/stats.mjs --data data --assets assets --out data/stats/latest.json
  ) || echo "statistics not updated this time"
fi

# Daily digest: once per UTC day, for the previous day, from the first run after midnight.
# The first digest is the archive's first day (a partial day, since it started mid-day).
YDAY=$(date -u -d yesterday +%F)
FIRST=$(head -c 400 data/captures.jsonl | grep -o '"captured_at":"[0-9-]*' | head -1 | cut -d'"' -f4)
if [ -n "$FIRST" ] && [ ! -f "data/stats/daily/$YDAY.json" ] && [[ ! "$YDAY" < "$FIRST" ]]; then
  (
    mkdir -p assets
    node code/archive/daily.mjs --data data --day "$YDAY" --list-assets > needed-day.tsv
    while IFS=$'\t' read -r tag asset; do
      [ -z "$asset" ] || [ -f "assets/$asset" ] || gh release download "$tag" -R "$GITHUB_REPOSITORY" -p "$asset" -D assets
    done < needed-day.tsv
    node code/archive/daily.mjs --data data --assets assets --day "$YDAY"
  ) || echo "daily digest not computed this time"
fi

cd data
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then exit 0; fi
git commit -q -m "Capture $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q origin HEAD:archive-data
