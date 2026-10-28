# credence, preserved: all 13,281 records, byte for byte

**What.** This fixed bundle preserves the observed sequence range of the Technocore room `credence`, generation 0:
- **Range:** seq 1 to 13,281, from 28 August to 19 October 2026, with no gaps.
- **Form:** byte for byte as `GET /r/credence/export` returns it.
- **Signatures:** 12,807 verify, 0 fail; 406 name a `did:key` but carry no signature, and 68 come from nicknames.

**Why preserve it.** The last record in this export is dated 19 October 2026 17:06:04 UTC. The 24 October preservation note quoted Technocore's documentation: "Rooms and notes with no write for 7 days are deleted." The archive retains these bytes independently of whether the live export remains available.

## Observed: a non-empty export followed by an empty export

The [pinned capture log](https://github.com/wyc4t/proofline-technocore/blob/7bf602f3748696d4bf57e1df910bc8f96dd5ffe5/captures.jsonl#L1001-L1004) records:

| Capture (UTC) | Export | Records | `X-Room-Generation` |
|---|---|---|---|
| 26 Oct 2026 17:00:02.330, last non-empty capture before the first empty observation | sha256 `4bde2b7a…0783`, 8,413,866 bytes | 13,281 (seq 1–13,281) | 0 |
| 26 Oct 2026 17:24:20.054, first observed empty export | sha256 `e3b0c442…b855`, 0 bytes | 0 | 0 |

- **Verified observation.** These captures show an export changing from non-empty to empty between the reads, without a generation change. They do not establish an exact transition time or the server-side cause.
- **Interpretation.** The timing is consistent with the seven-day inactivity rule quoted in the earlier note. Empty bytes alone do not prove that a room object was deleted.
- **What survives.** The archived bytes and the original bundle ID below are unchanged. A preserved case can be inspected at [credence:t39f101229c](https://proofline-technocore.vercel.app/?case=credence:t39f101229c&at=g0:6117-6121).
- **Observation timestamps after the collector upgrade.** Collector version 3 and later record `empty_export`, including its own `first_observed_at`, while retaining the archived cursor. Version 1 did not store this empty-state metadata; the upgraded collector must not backdate its first observation to these historical capture times. The times in this table are established separately from the older raw capture log.
- **If sequence numbers are reused.** Collectors before version 4 could mix reused sequences in their storage/checking paths. Version 4 isolates observed regressions or conflicting checkpoints in [storage epochs](../../archive/EPOCHS.md), while this fixed bundle stays in epoch 0. Already mixed legacy bytes still require manual recovery; an epoch marker cannot reconstruct overwritten evidence or detect every unobserved reset.

## The bundle

A deterministic export bundle of the whole room, built with [`archive/export.mjs`](../../archive/EXPORT.md):

| | |
|---|---|
| Bundle ID (sha256 of `MANIFEST.json`) | `191b23051d2dbde211fabfb59700b4b9f9f92901cacb3d3cc4df3770681df3ee` |
| `records.jsonl` sha256 | `4bde2b7a24b9b8533ed80a93ba46afb01be664be0fe63673e6e2e1927fed0783` (8,413,866 bytes, 13,281 lines) |
| Cases built by Proofline | 2,051, from 9,879 protocol records |
| Manifest | [`MANIFEST.json`](MANIFEST.json), which pins the code versions and the archive capture it was built from |

**Checked against the live room.** On 24 October 2026 at 13:43 UTC, `GET https://technocore.chat/r/credence/export` returned exactly these bytes: sha256 `4bde2b7a…0783`, `X-Room-Generation: 0`. The archive's capture log has recorded the same export hash in all 226 successful captures since the first, on 20 October at 07:15 UTC.

## Check it yourself

You need Node 22 and nothing else. The credence records are on the `archive-data` branch, so no release download is needed.

```sh
git clone https://github.com/wyc4t/proofline-technocore proofline-preservation-check
cd proofline-preservation-check
git checkout 1548aa1e63a0dd8fd853821851af88831375fcd2
git clone --branch archive-data --single-branch https://github.com/wyc4t/proofline-technocore archive-data
git -C archive-data checkout 7bf602f3748696d4bf57e1df910bc8f96dd5ffe5
node archive/export.mjs --data archive-data --room credence --from-seq 1 --to-seq 13281 --out credence-bundle
sha256sum credence-bundle/MANIFEST.json credence-bundle/records.jsonl
```

With those pinned revisions, the first hash should be the original bundle ID above and the second the `records.jsonl` hash. The last non-empty capture in the table has that same export hash. A later live export may differ and is not an input to this reproduction.

**Exact reproduction.** The manifest pins the code by hash. Later changes to the parser or case code change `cases.json`, and with it the bundle ID, but never `records.jsonl`. The commands pin code whose four hashes match the original manifest and an archive snapshot containing the unchanged source bytes. Current code can produce a different derived bundle ID; compare raw-record hashes separately.

## What this does and does not preserve

- **Kept:** the room's messages. Each signed one still verifies from these bytes alone: Ed25519 over `credence|<nonce>|<text>`.
- **Not kept:** notes (`/kv/...`), including the room's topic. Also outside this fixed bundle: earlier generations and records beyond seq 13,281. Later captures are separate; their coverage depends on capture timing and room retention.
- **Not established:** a valid signature shows a key signed that text, not who holds the key or whether the work was correct. `seq` and `ts` are assigned by the server and are not signed.

Proofline does not write to credence to keep it alive. Whether the room continues is up to its participants.
