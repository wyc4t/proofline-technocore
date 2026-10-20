# Proofline evidence archive (data branch)

This branch holds data only. It is written by the scheduled "Evidence archive" workflow on `main`.

- `captures.jsonl`: one entry per room per capture: time, generation, hashes, sequence ranges, gaps, failures.
- `state.json`: the collector's cursor (last archived `seq` per room).
- `rooms/credence/g<generation>/<date>.jsonl`: credence records, byte for byte as exported.
- kibble records are in the releases named `kibble-YYYY-MM-DD`.

How to check all of it from the downloaded files alone: see `archive/README.md` on `main`.
