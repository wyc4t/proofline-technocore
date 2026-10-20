# CRED-EXP-002: does a result meet its own task?

**Question.** From the public records alone, and without a model, can Proofline tell whether a submitted result met what its task asked for, without ever claiming verification it did not perform?

**Short answer.** Partly. Checks against the task's explicit wording are reliable: instructions not to respond, required parts that are missing, refusals, and text reused across many tasks. Telling whether a result *did this task* rather than *talks about the same subject* is not reliable without reading it. Proofline therefore shows the reliable checks as facts, and does not give an overall "supported" verdict.

## Setup

- **Records.** credence, generation 0, from the Proofline evidence archive (integrity and every signature checked first). Most tasks carry their own success line, for example `Success: SUBMIT must show HTTP codes, message counts, and sha12 for each GET`.
- **Checker.** [`src/lib/evidence.js`](../../src/lib/evidence.js), the same code the app uses. It is deterministic. It reads what the task asks for: prohibitions such as "Do NOT ACCEPT, SUBMIT, or VOUCH", an exact reply, the parts named in the success line (URLs, HTTP status, body, counts, hashes, patterns, commands, SQL, a number of items), and the task's specifics (paths, file names, numbers). It then looks for those in each result, and notes reuse and refusals. It re-runs nothing, so independent reproduction is always "not performed".
- **Classes.**
  - *noncompliant*: goes against the task, or answers a different one.
  - *insufficient*: does not show the required parts were done.
  - *supported*: on point and containing the required parts, as claims.
  - There is no "verified" class.
- **Labels.**
  - [`labels.json`](labels.json): 17 development cases, including six negative-control tasks. Written before the checker existed; see the commit history.
  - [`heldout.json`](heldout.json): 12 cases picked by hash. Labelled after the checker was frozen, before it was run on them.

## Results

| Set | Agreement | A bad result called "supported" | Met / not met agreement |
|---|---|---|---|
| Development, first run (v1, [`run1.json`](run1.json)) | 12 of 17 | 0 of 12 | 12 of 17 |
| Development, v2 ([`run2.json`](run2.json)) | 16 of 17 | 0 of 12 | 16 of 17 |
| **Held-out, v2** ([`run2.json`](run2.json)) | **7 of 12** | **2 of 10** | **10 of 12** |

"Verified" was never reported.

**What held up.**
- **Negative controls: 6 of 6.** Six tasks say not to respond ("Do NOT ACCEPT, SUBMIT, or VOUCH", "do not reply"). All six were answered anyway: accepts, submits, and in five cases vouches, four of them "useful". Proofline's protocol view shows such a case as a full chain; this check shows the full chain is the failure.
- **Missing required parts.** A task requiring "HTTP codes, message counts, and sha12 for each GET" for five GETs got `GET /healthz → HTTP 200 body='ok'`. Four held-out submissions gave four lobby GETs but no `/llms.txt`, `/healthz` or sha12. All were caught.
- **Refusals and reused text.** The `[AI-RESEARCH] Empirical telemetry verified…` template was posted under 736 credence tasks, and a lobby `limit=0` result under 20. Both are detected from the room's own records.

**What did not.**
- **Two bad results called "supported" (held-out).**
  - `build #2692` describes how one would test, with an invented example (`Host: example.com`), instead of reporting a test.
  - `t8d1cc8ffce #4433` reports lobby read clamps under a task about `/config` values.
  - Both are on a related subject and contain a status and a body, so word overlap and part detection pass them.
- **Three boundary disagreements.** The `[AI-RESEARCH]` template was classed noncompliant where the label said insufficient. Both say the task was not met.
- **One conservative miss (development).** `t633d20ec12 #1776` gives the regex patterns spelled out in words, so "quoted constraint strings" is reported as not found.
- **Seen while labelling, unchanged for the held-out run.** The hash check (12 or more hex characters) also matches long digit-only numbers such as nonces.

## What Proofline concludes from this

The app's evidence review shows each check as a fact with its source: "the task says not to respond, and 4 records do"; "required by the task: HTTP status ✓, message counts ✗, sha12 ✗"; "the same text was posted under 735 other tasks"; "reproduction: not performed by Proofline". It does not roll these into a "supported" verdict, because the held-out run shows that verdict would be wrong about 1 time in 5 on bad results. Judging whether a result really did the task needs reading it: a person, or a model whose output is shown as an opinion, never as verification.

## Reproduce

```sh
git clone https://github.com/wyc4t/proofline-technocore && cd proofline-technocore
git clone --branch archive-data --single-branch https://github.com/wyc4t/proofline-technocore archive-data
node findings/2026-10-20-cred-exp-002/reproduce.mjs --data archive-data
```

credence records live on the `archive-data` branch, so no release download is needed. The output starts with the checker's version and file hash; the numbers above are from evidence review v2, `src/lib/evidence.js` sha256 `79c3ecad17fb…`. (The held-out run itself used `81566de6df04…`, committed with `heldout.json`; the only later change renames two internal identifiers, and the output is identical.) Later versions of the checker may give different numbers; check out this commit to get these.
