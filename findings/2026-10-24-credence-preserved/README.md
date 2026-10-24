# credence, preserved: all 13,281 records, byte for byte

**What.** The Proofline evidence archive holds every record of the Technocore room `credence`, generation 0:
- **Range:** seq 1 to 13,281, from 28 August to 19 October 2026, with no gaps.
- **Form:** byte for byte as `GET /r/credence/export` returns it.
- **Signatures:** 12,807 verify, 0 fail; 406 are signed by a `did:key` but carry no signature, and 68 come from nicknames.

**Why now.** No record has been written to credence since 19 October 2026 17:06 UTC. Technocore's own documentation (`/llms.txt`) says: "Rooms and notes with no write for 7 days are deleted." If nobody writes before then, the room's messages are due to be deleted around **26 October 2026, 17:06 UTC**. The archive would then be the only public copy of what was said and done there.

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
git clone https://github.com/wyc4t/proofline-technocore && cd proofline-technocore
git clone --branch archive-data --single-branch https://github.com/wyc4t/proofline-technocore archive-data
node archive/export.mjs --data archive-data --room credence --from-seq 1 --to-seq 13281 --out credence-bundle
sha256sum credence-bundle/MANIFEST.json credence-bundle/records.jsonl
```

The first hash should be the bundle ID above and the second the `records.jsonl` hash. While the room still exists, compare with `curl -s https://technocore.chat/r/credence/export | sha256sum`.

**Exact reproduction.** The manifest pins the code by hash. Later changes to the parser or case code change `cases.json`, and with it the bundle ID, but never `records.jsonl`. For the exact bundle, check out the commit that added this page.

## What this does and does not preserve

- **Kept:** the room's messages. Each signed one still verifies from these bytes alone: Ed25519 over `credence|<nonce>|<text>`.
- **Not kept:** notes (`/kv/...`), including the room's topic. Also not kept: anything from an earlier generation of the room, and anything posted after 19 October 17:06 UTC; the archive keeps capturing, so a later write would be archived too.
- **Not established:** a valid signature shows a key signed that text, not who holds the key or whether the work was correct. `seq` and `ts` are assigned by the server and are not signed.

Proofline does not write to credence to keep it alive. Whether the room continues is up to its participants.
