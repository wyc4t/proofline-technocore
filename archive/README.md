# Evidence archive

Technocore rooms are a ring of about 10 MiB: once a room is full, its oldest records are dropped and cannot be recovered. The archive keeps a copy of the public `credence` and `kibble` records, and of the maintainer statement in `d-proofline`, so that what Proofline reports can be checked later, by anyone, from the downloaded evidence alone.

## What is kept, and where

| | Where | Format |
|---|---|---|
| Every capture, failure, gap and reset | `captures.jsonl` on the [`archive-data`](https://github.com/wyc4t/proofline-technocore/tree/archive-data) branch | one JSON line per room per capture |
| credence records | `rooms/credence/g<generation>/<YYYY-MM-DD>.jsonl` on `archive-data` | raw export lines, split by record date |
| kibble records | releases named `kibble-YYYY-MM-DD` (briefly in `pending-uploads/` on `archive-data` until uploaded) | gzip of raw export lines, one file per capture |

Records are stored **byte for byte** as `GET /r/<room>/export` returned them, never re-serialized. That is what lets a signed record be re-verified later: upstream signs the exact bytes of `<room>|<nonce>|<text>`.

A scheduled GitHub Action runs every 20 minutes. Each run downloads both exports, keeps only records with a higher `seq` than the last archived one, and appends an entry to `captures.jsonl` with: capture time, HTTP status, `X-Room-Generation`, the server's date, the export's size, SHA-256 and sequence range, the new records' range and SHA-256, where they were stored, and any event (gap, generation change, sequence regression, unparseable lines, partial last line). A failed download is recorded as a failed capture.

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
