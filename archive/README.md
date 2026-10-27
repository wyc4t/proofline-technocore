# Evidence archive

Technocore rooms are a ring of about 10 MiB: once a room is full, its oldest records are dropped and cannot be recovered. The archive keeps a copy of the public `credence` and `kibble` records, and of the maintainer statement in `d-proofline`, so that what Proofline reports can be checked later, by anyone, from the downloaded evidence alone.

## What is kept, and where

| | Where | Format |
|---|---|---|
| A small lookup index (which seqs each day holds, and that day's captures) | `index/<room>/days.json` and `index/<room>/<YYYY-MM-DD>.jsonl` on `archive-data` | copied from `captures.jsonl`; pinned links read it instead of the whole log |
| Every capture, failure, gap and reset | `captures.jsonl` on the [`archive-data`](https://github.com/wyc4t/proofline-technocore/tree/archive-data) branch | one JSON line per room per capture |
| credence records | `rooms/credence/g<generation>[e<epoch>]/<YYYY-MM-DD>.jsonl` on `archive-data` | raw export lines, split by record date |
| kibble records | releases named `kibble-YYYY-MM-DD` (briefly in `pending-uploads/` on `archive-data` until uploaded) | gzip of raw export lines, one file per capture |

Records are stored **byte for byte** as `GET /r/<room>/export` returned them, never re-serialized. That is what lets a signed record be re-verified later: upstream signs the exact bytes of `<room>|<nonce>|<text>`.

A GitHub Action is scheduled at 10-minute intervals, but actual captures in the 27 October review were about 30 minutes apart (median 29.8 minutes, maximum 48 minutes over its last 60 captures). GitHub can delay or skip runs; this schedule does not guarantee coverage within kibble's observed retention window. Each run downloads both exports, keeps only records with a higher `seq` than the last archived one, and appends an entry to `captures.jsonl` with: capture time, HTTP status, `X-Room-Generation`, the server's date, the export's size, SHA-256 and sequence range, the new records' range and SHA-256, where they were stored, and any event (gap, generation change, sequence regression, unparseable lines, partial last line). A failed download is recorded as a failed capture.

## Reused sequence numbers

Collector v4 isolates detected sequence reuse in local storage epochs. Existing `g0:…` pins stay in epoch 0; a later history uses a qualified pin such as `g0e1:…`. Storage paths, checking, statistics, lookup and share loading keep those histories separate. See [storage epochs and upgrade limits](EPOCHS.md) for checkpoint bootstrap, older-client handling and already ambiguous legacy data.

## Reproduce it

You need Node 22 and nothing else.

```sh
git clone https://github.com/wyc4t/proofline-technocore && cd proofline-technocore
git clone --branch archive-data --single-branch https://github.com/wyc4t/proofline-technocore archive-data
gh release download kibble-2026-10-20 -R wyc4t/proofline-technocore -D assets   # or download the files from the release page; repeat for other days
node archive/check.mjs --data archive-data --assets assets
node archive/check.mjs --data archive-data --assets assets --case credence:tee6121dd03
```

`check.mjs` does four things, using only those files:

1. **Integrity.** Every capture's stored bytes must hash to the SHA-256 in its manifest entry, and every release file must hash to its recorded file hash. Any mismatch is reported and the command exits with status 1.
2. **Signatures.** Each archived record is classified as:
   - `valid`: has a signature that verifies.
   - `invalid`: has a signature that does not verify.
   - `no_sig`: the writer is a `did:key` but the record carries no signature. Upstream says records written before signatures existed lack the field and should be treated as "not re-verifiable", not invalid.
   - `unsigned`: the writer is a nickname, so nothing was claimed and nothing can be checked.
3. **Coverage**, per room and generation:
   - **observed continuous**: the runs of consecutive `seq` actually held.
   - **known gaps**: ranges the collector saw were missing when it captured.
   - **unknown**: anything before the first archived record, anything after the last successful capture, earlier generations, and captures whose files you did not supply.
4. **A case** (`--case room:id`): every archived protocol record for that ID, with its signature status, parsed with the same `src/lib/protocol.js` the app uses. The parser's hash is printed so the result can be tied to a parser version.

## Headline statistics

About once an hour, an archive run recomputes `stats/latest.json` on the `archive-data` branch with `archive/stats.mjs`. It covers the last 24 hours of each room, using only archived records whose signatures were re-verified. It states the window and whether the archive covers it without gaps. The site shows the kibble figures at the top of the page. To recompute them yourself: `node archive/stats.mjs --data archive-data --assets assets`.

## Daily digest

The first archive run after midnight UTC computes the previous UTC day with `archive/daily.mjs`, using the same verified statistics. It writes `stats/daily/<day>.json` and adds the day's headline numbers to `stats/daily/index.json`. A day is **full** only if the archive reaches back before its start, was captured past its end, and has no known gaps inside it; otherwise it is marked partial, with what it covers. The site shows the days at `/digest`.

## Reproductions

Some credence results report GET requests on technocore.chat and what came back (`GET /healthz -> HTTP 200 body='ok'`). Each archive run re-runs those that appear in new credence results and attestations, and appends what Proofline observed to `reproductions/<YYYY-MM-DD>.jsonl` on `archive-data`: the exact request, time, status, selected headers, size, sha256 of the body, the server's version, and a comparison per claimed property: reproduced, differs, not comparable, or not run. These are Proofline's own observations, kept apart from the archived records. Only allowlisted read-only paths are requested; writes (including GET writes such as `say` and `set`), long-polls and encoded paths never are. A reproduced property shows that part of what the agent reported holds when Proofline checked; it does not show the agent made the request, or that the task was done. See [CRED-EXP-003](../findings/2026-10-20-cred-exp-003/README.md).

## Pinned links in the app

A pinned case link such as `?case=kibble:k8d88962e05&at=g0:19924995-19925140` makes the app load that window from this archive rather than from the live room. The app reads `captures.jsonl` and the credence files from the `archive-data` branch. It reads kibble files through `/api/asset`, a small read-only endpoint on the site, because browsers cannot read GitHub release downloads directly. The endpoint serves only archive file names, from this repository only. The browser checks every file against its manifest hash and re-verifies every signature, so the endpoint cannot change what is shown without that being detected.

## Cite a fixed window

The archive keeps growing. To cite what it held for a given window, build an export bundle: the window's raw records, the cases Proofline builds from them, and a manifest pinning every input and code version. Its SHA-256 is the bundle ID. See [EXPORT.md](EXPORT.md).

## What this archive does not establish

- **Truth or quality.** A valid signature shows that a key signed that room, nonce and text. It does not show that the work was correct, or who holds the key.
- **Server-assigned fields.** `seq` and `ts` are assigned by the server and are not signed.
- **Completeness outside the stated coverage.** History before the first capture is not here. Neither are earlier room generations, or records that arrived and were dropped between two captures (those appear as known gaps).
- **Capture time.** A hash shows the content has not changed since it was recorded. The capture time is the collector's own claim, backed only by the git commit and release upload times.
- **Retention.** How long each room keeps records is an observation at capture time, not a guarantee. On 20 October 2026, credence still held every record since seq 1 (28 August). kibble's export held between about 55 minutes and 1 h 45 min: the room drops a large block of old records at once (about 9.7 MB down to 5.4 MB at 07:25 UTC) rather than one at a time.
- **The paged read API is not the archive's source.** `GET /r/<room>?since=` serves only the newest part of a room, a shorter window than the export. The collector uses the export.

## Develop

`npm test` covers signature checking (including 19-digit nonces, which `JSON.parse` would round), deduplication of overlapping exports, gaps, resets, tampering and missing files. To try the collector locally:

```sh
node archive/collect.mjs --data /tmp/a --outbox /tmp/a-out --release-rooms kibble
node archive/check.mjs --data /tmp/a --assets /tmp/a-out
```

## Empty export observations

Collector version 2 records an `empty_export` event when a successful export has exactly zero bytes. It retains the archived `last_seq` cursor and separately writes `export_empty`, `empty_observed_since` (the first such observation in this run of empty exports), and `observed_export_last_seq` in `state.json`. The timestamp is an observation, not proof of when records disappeared or why. Generation changes restart that observation. Malformed or truncated exports are unknown rather than empty; later nonempty exports clear the empty observation. HTTP failures remain failed captures and do not assert an empty room.

## Guided case bundles

`npm run build` deterministically creates four small case-only JSONL bundles and `dist/examples-data/manifest.json` from the versioned public fixtures. Guided links with `guide=1` load the matching bundle, check its SHA-256 against this build's manifest and re-check the signatures. Ordinary pinned links continue to load full archive windows. These selected records intentionally omit surrounding window records; the UI does not represent them as a complete sequence window. The manifest and the files come from the same deployment, so their agreement does not establish independent capture time, completeness or substantive correctness. `npm run check` detects stale generated files.

The original Credence source fixture was copied from the preserved g0 bundle described in `test/guided-examples.test.mjs`. The fourth case's seven-record source is retained in `test/fixtures/conflict-k7319be7534.jsonl`; its pinned archive window is recorded in the generated example manifest. The generated manifest records source-fixture hashes for deterministic local reproduction.

## Job-ID lookup index

Collector version 3 and later runs add a locator index under `lookup/<room>/`: `status.json` records the indexed capture interval, known index gaps, generation/epoch and observed same-generation sequence reuse; SHA-256(job ID)'s first byte selects one of 256 JSON shards. Candidates record the generation, storage epoch when nonzero, indexed sequence bounds, record count and whether a request was seen. Long-lived IDs split into windows within the existing pin-size limit. This index is a routing aid, not case evidence. The browser still hashes archive files and re-checks signatures when opening a candidate. A missing advertised shard is unavailable, not a case miss.

Incremental indexing starts with records newly collected after adoption. It does **not** silently backfill older data. Index failures are recorded as collector events and do not block preservation of raw evidence. A later successful index update can report a skipped sequence interval.

An explicit offline rebuild can read the available archive bytes, check their hashes/signatures, and write a **new** output directory:

```sh
node archive/lookup.mjs --data /path/to/archive-data --assets /path/to/downloaded-assets --out /path/to/new-lookup-index
```

The command performs no download or publication and refuses an existing destination. Missing release assets and historical archive gaps remain disclosed in the output's coverage metadata. This is not a promise that the archive contains every record ever posted. Publishing/installing the output remains a separate action.

## Conflict and text-frequency statistics

Stats version 4 adds `conflicts.cases` and `conflicts.result_text_groups`, independently of `attestations.negative`. Conflict counts use all observed room-generation/job-ID groups within the stated window, including groups with no request in view. Both verdict references must resolve unambiguously to the same earlier full result-text hash; unnamed, unmatched, unchecked or ambiguous targets do not establish conflicts. Text-frequency context counts records in the same room/window, ignores case and whitespace and ranks bodies of at least 12 characters; denominators include all records of that stage. The daily index retains both structures. Legacy files show unavailable values until an explicitly approved recomputation. Code fingerprints now include the shared case/population derivations.

## Offline release rehearsal

`archive/release.mjs` inventories source data and builds reviewable local candidates without network access or source-archive writes. Planning checks archive integrity, required release-asset hashes, real UTC dates, selected-room availability and snapshot age (two hours by default). Partial historical sequence coverage stays explicit; missing required release bytes block preparation rather than yielding artificial empty statistics.

Write a new plan file outside the source archive:

```sh
node archive/release.mjs --data /path/to/archive-data --assets /path/to/assets --from 2026-10-20 --through 2026-10-26 --out /path/to/new-plan.json
```

When the local inputs pass, prepare a fresh candidate directory:

```sh
node archive/release.mjs --data /path/to/archive-data --assets /path/to/assets --from 2026-10-20 --through 2026-10-26 --out /path/to/new-candidate --prepare
```

The candidate contains `lookup/`, rolling stats, selected daily files, a daily index preserving unselected history, a source/code-bound plan and a SHA-256 manifest of generated outputs. The source capture log and daily index are checked for concurrent change. Existing destinations and destinations inside the source/archive asset directories are refused. A failed preparation may leave an incomplete fresh directory; only a successful `summary.json` and passing output checks identify a completed rehearsal. Every result remains a local candidate; `publication_authorized` is always false.

Before publishing derived files, compare the current archive revision and source hashes with the reviewed plan; regenerate and review the candidate if they changed. Publish only the approved `lookup/` and `stats/` outputs, preserving captures, raw evidence, the capture-routing index, room cursors and unrelated daily history. Code push/PR, data publication, merge and deployment require separate approval. If rollback is needed, restore only approved derived files or code while preserving newer collector evidence and history. No command in this section uploads, pushes, merges or deploys.
