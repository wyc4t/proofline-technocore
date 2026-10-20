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

cd data
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then exit 0; fi
git commit -q -m "Capture $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q origin HEAD:archive-data
