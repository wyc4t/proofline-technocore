# kibble: 23 job IDs were each posted by 39 to 61 keys

**Observed 20 October 2026 in the Proofline evidence archive.** Everything below is reproducible with the commands at the end, and holds only for the window stated.

## Scope

| | |
|---|---|
| Room | `kibble`, generation 0 |
| Window | seq 19,898,626 – 19,923,217, records dated 05:32:16 – 07:38:48 UTC (about 2 h 7 min) |
| Coverage | every seq in the window is archived; no known gaps |
| Records | 24,592, all with signatures that verify |
| Export bundle | `7f62172931c49118159c27a2e598d1359a32ca3ab21c959f20db46aa52815e5b` |

## What was observed

- The window holds **3,805 JOB records** under **2,678 distinct job IDs**.
- **23 job IDs each carry JOB records from 39 to 61 different keys**, all with verified signatures. Together that is 1,149 JOB records.
- **Within each of the 23 IDs, every JOB record has byte-identical text.**
- **For all 1,149 of those records, the ID is `k` followed by the first 10 hex characters of the SHA-256 of the job's title.** No other JOB record in the window has an ID built this way.
- **382 distinct keys posted these JOB records. None of them posted a JOB under any other ID in the window.**
- **None of these JOB records uses one of the five categories** in kibble's published format (explain, research, review, build, coordinate). They use categories such as systems, algorithms, web and networking. Among the other JOB records, 68% use one of the five.
- **Under the 23 IDs there are 399 worker records** (of 8,173 in the window), **226 results** (of 6,054) and **68 attestations** (of 6,097).

## Why it matters for builders

A CLAIM, RESULT or ATTEST in kibble names only the job ID (`CLAIM v1 | <job_id> | worker`). Kibble's published format defines the ID's shape, `k` plus 10 hex characters, but not how it is generated or whether it must be unique. When an ID comes from the title alone, every posting of the same title shares it. The records then cannot say which of up to 61 identical JOB postings a given claim or result answers, or which requester it was for.

This affects anything that groups kibble records by job ID, including Proofline itself. Each of these 23 IDs appears in Proofline as a single case with dozens of requesters. Checks that depend on the requester, such as "the poster, worker and validator must be three different parties", become ambiguous under these IDs.

## What this does not show

- **Who controls the 382 keys,** or whether they are related. Distinct keys are not shown to be distinct parties.
- **Intent.** Kibble's documentation mentions that the board ignores "hash-suffix JOB farming for score". These records may be what that refers to, but the records alone do not say.
- **Whether the board treats these records differently.** Proofline reads only the public room, not kibble's board API.
- **Anything outside the window** stated above.

## Open question (not a finding yet)

Many kibble attestations name job IDs for which no JOB, claim or result appears in the room. In this window, 3,593 of the 3,647 IDs with no observed JOB begin with an ATTEST record. Part of this is the window's start: jobs posted before 05:32 UTC are not in the archive. But about 31% of IDs first seen more than an hour into the window still have no observed JOB. Settling this needs a longer archive, and possibly kibble's board API, since kibble asks attestations to include a result hash taken from that API.

## Reproduce

Node 22 only.

```sh
git clone https://github.com/wyc4t/proofline-technocore && cd proofline-technocore
git clone --branch archive-data --single-branch https://github.com/wyc4t/proofline-technocore ../archive-data
gh release download kibble-2026-10-20 -R wyc4t/proofline-technocore -D ../assets
node archive/export.mjs --data ../archive-data --assets ../assets --room kibble \
  --from-seq 19898626 --to-seq 19923217 --out ../bundle
node findings/2026-10-20-kibble-reused-job-ids/reproduce.mjs ../bundle
```

`reproduce.mjs` reads only the bundle, checks its files against its manifest, and prints every number on this page.

The bundle pins the code that built it, so the bundle ID above is reproduced by the code as it was when this finding was published. Later changes to the parser give a different ID for the same records. To get exactly `7f62172…`, run the export from that commit:

```sh
git checkout 82c414a
node archive/export.mjs --data ../archive-data --assets ../assets --room kibble \
  --from-seq 19898626 --to-seq 19923217 --out ../bundle
git checkout main
```

On current `main`, the same commands produce a different bundle ID and the same numbers.
