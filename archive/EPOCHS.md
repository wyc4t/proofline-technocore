# Archive storage epochs

Collector v4 separates observed histories that reuse upstream sequence numbers. An upstream `X-Room-Generation` is still recorded as reported; a **storage epoch** is an additional local archive namespace, not a claim that a server-side room was deleted or recreated.

## When the namespace changes

A room starts in storage epoch 0. Its epoch increases on an observed generation change, an export whose last sequence is below the archived cursor, or different bytes at the saved high-water sequence. The checkpoint is the SHA-256 of that record's exact JSONL bytes excluding the final newline. Signatures still bind only room, nonce and text; sequence numbers and timestamps are server-assigned.

An incomplete or non-monotonic export cannot by itself establish an inferred counter boundary; that capture fails with the prior cursor retained. An empty export retains the cursor and checkpoint. The same old bytes reappearing after an empty read do not start a new epoch. A generation value returning after another generation receives a new room epoch, so it cannot reuse the earlier namespace.

Only observed boundaries are separated. A reset wholly outside the captured overlap can remain undetected if the saved checkpoint is absent from the next export and the counter has already passed it. Epochs do not establish reset cause, independent work or distinct real-world tasks.

## Storage and links

Epoch 0 preserves existing filenames and pinned links:

- Git records: `rooms/credence/g0/2026-10-27.jsonl`.
- Release asset: `kibble-g0-1-3.jsonl.gz`.
- Pin: `at=g0:1-3`.

A later epoch uses separate paths and an explicit pin:

- Git records: `rooms/credence/g0e1/2026-10-27.jsonl`.
- Release asset: `kibble-g0-e1-1-3.jsonl.gz`.
- Pin: `at=g0e1:1-3`.

An unqualified old pin always means epoch 0, never the latest epoch or a union of histories. The checker and exporter keep groups such as `g0` and `g0e1` separate. Export format 2 explicitly records the selected storage epoch; older format-1 bundles remain historical artifacts. To export a later epoch:

```sh
node archive/export.mjs --data /path/to/archive-data --assets /path/to/assets --room kibble --generation 0 --epoch 1 --from-seq 1 --to-seq 3 --out /path/to/new-bundle
```

The browser and server-side share loader accept qualified pins; a new-epoch card names its epoch. A live room response cannot establish its archive epoch. When archive status is unknown, its cursor is ahead of the live room, or an epoch/reset boundary is known, the live inspector directs the reader to archive lookup instead of guessing a pinned link.

## Derived indexes and older clients

Capture routing keeps epoch 0 in `index/<room>/` and later epochs in `index/<room>/e<N>/`. Even a room first populated in a later epoch gets an empty epoch-zero routing header. Legacy readers therefore cannot combine later captures through the ordinary old index path. Headers identify epoch-aware, partitioned routing; new readers fall back to the full capture log when an older index lacks that information.

Locator metadata remains format 1 for safe epoch-zero data and becomes format 2 when it must represent later or ambiguous legacy epochs. New clients accept both formats. Old lookup clients refuse format 2 instead of generating a wrong unqualified pin. Reload existing pages when rolling out the new client; old scripts cannot understand new qualified pins, and their full-manifest fallback is not epoch-aware.

The collector rebuilds the derived capture-routing index once on upgrade, leaving raw records and captures untouched. An interrupted migration leaves temporary directories for inspection instead of silently discarding them. Rebuilding the case locator remains an explicit offline action; migration does not infer missing historical evidence.

## Upgrade checkpoint bootstrap

State/captures now include `storage_epoch`; state also keeps `last_record_sha256`. Old state defaults to epoch 0. Before accepting a nonempty caught-up export, the collector bootstraps a missing checkpoint from the archived high-water capture, verifying its compressed hash (if applicable), raw capture hash and record count.

Git-room bytes are already local. The workflow requests at most one existing release capture per legacy release-room cursor while its checkpoint is missing:

```sh
node archive/bootstrap.mjs --data /path/to/archive-data --list-assets
```

The workflow downloads these named files into a temporary checkpoint cache and passes `--checkpoint-assets` to the collector. The bootstrap is local and read-only; fields are persisted with the normal successful capture. Missing or mismatched bytes produce a capture failure with the old cursor retained. A missing cursor for existing history also fails rather than appending a new history to old files. A different byte sequence cannot replace an existing local release filename.

## Statistics, reproduction and limits

Stats version 5 groups jobs and outcomes by room, generation, storage epoch and job ID. Same-ID requests/results/verdicts in different epochs never answer or conflict with one another. Record-frequency context remains scoped to the room/window. Epoch-zero counts remain compatible with the verified v4 data; existing v4 files still render. The automatic read-only reproduction cursor also switches epochs without replaying earlier claims.

Already mixed **legacy** histories require recovery from independently preserved bytes. A pre-epoch regression or repeated generation makes that affected legacy group unavailable to the checker, exporter and updated snapshot loader. Its legacy routing rows are withheld as well. This change does not invent boundaries, recover overwritten release assets, or repair old records in place. Keep original evidence for manual recovery.

Roll out only after reviewing code and workflow changes. No existing archive or deployment is changed by running unit tests or offline reproduction. Publishing code, derived data or recovery changes requires its own approval. Once a nonzero epoch has been written, do not roll the collector back to a pre-v4 version: it does not understand the namespace and could append to legacy paths. Keep an epoch-aware collector or stop it during an approved recovery; never remove epoch fields or rewind cursors to undo a UI release.
