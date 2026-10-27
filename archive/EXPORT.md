# Export bundles

`archive/export.mjs` turns one room and one fixed sequence window of the [evidence archive](README.md) into a bundle you can cite. Running it again on the same archive with the same code produces byte-identical files and the same bundle ID. A finding can therefore name a bundle ID, and anyone can regenerate the bundle and compare.

```sh
node archive/export.mjs --data <archive-data> --assets <release files> --room kibble \
  --from-seq 19898626 --to-seq 19923217 --out bundle
```

New bundles use export format 2 and explicitly record `storage_epoch`. A plain generation selects storage epoch 0. Add `--epoch N` to export a later local archive history; see [storage epochs](EPOCHS.md). Records are never joined across epochs.

The export refuses a window that contains sequence numbers the archive does not hold, whether from a known gap or from outside what was captured. `--allow-gaps` overrides this, and the manifest then records how many are missing.

## Files

### `records.jsonl`

The room's records in the window, ascending by `seq`, byte for byte as Technocore exported them. Signatures re-verify from these lines alone.

### `cases.json`

The cases Proofline builds from those records, using the same parser and case code as the app (`src/lib/protocol.js`, `src/lib/cases.js`), sorted by `key`. Each case has:

| field | meaning |
|---|---|
| `key`, `room`, `id` | the case is `room:id`; the same ID in two rooms is two cases |
| `title` | taken from the case's own request, if one was observed |
| `status` | `all-stages`, `partial` or `no-request` |
| `stages` | record counts for request, worker, result, attestation |
| `verdicts`, `negative` | attestation verdict counts, and whether any is negative |
| `attestation`, `continuity` | the key comparisons shown in the app; they use only keys whose signature verified |
| `elapsed_first_ms`, `elapsed_last_ms` | request to first and last result, from unsigned server timestamps |
| `flags` | pattern flags, with the `seq` of each record involved |
| `records` | every protocol record of the case: `seq`, `kind`, `ts`, `from`, `sig_status` (`valid`, `invalid`, `no_sig`, `unsigned`), and `key` (the sender if its signature verified, otherwise `null`) |

Lines that are not protocol records, such as chat, appear in `records.jsonl` but in no case.

### `MANIFEST.json`

Pins everything the bundle depends on:

- `window`: the room, generation and sequence range, with the first and last record times.
- `coverage`: how many sequence numbers in the window the archive lacks, and any known gaps.
- `files`: the SHA-256, size and count of `records.jsonl` and `cases.json`.
- `signatures`: verification counts over the window.
- `code`: the SHA-256 of the parser, case builder, verifier and exporter that produced the bundle.
- `archive_inputs`: every capture the records came from, with its own hash and where it is stored.
- `limits`: what the bundle does not establish.

The **bundle ID** is the SHA-256 of `MANIFEST.json`. Because the manifest includes the code hashes, a code change produces a new ID even when the records are the same. To reproduce an older bundle, check out the commit it was made with.
