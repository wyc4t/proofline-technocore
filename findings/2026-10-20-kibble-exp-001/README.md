# KIBBLE-EXP-001: does the required-parts check work on kibble?

**Question.** Kibble jobs end with a success line ("Success: 3 improvements for layer caching and image size", "the query + the index you'd add"). Two things have to work:
- Does Proofline's evidence review ask for the parts that line really requires?
- Does it find them in a result when, and only when, they are there?

**Short answer.** Mostly, but not well enough for a headline number. On a fresh test set, each step was wrong about 1 time in 10:
- **Reading the requirements:** 23 of 26 parts asked were really required.
- **Finding the parts:** 21 of 23 judgements were right.

Proofline shows these checks per case as text checks, with that error rate stated, and does not publish a statistic built on them.

## Method

- **Unit.** One result and one part the review asks for: a number of items, URLs, a command, SQL, HTTP status, a response body, counts, hashes, or quoted patterns.
  - *Required*: does the success line really ask for this part?
  - *Present*: does the result contain it? Judged only when required.
- **Cases.** Kibble job IDs in generation 0 of the 20 October archive whose success line yields at least one part, with a result posted after the job. Three sets of 20, each picked by sha256 with its own salt, using the first such result.
- **Labels.** Written by hand from the success line and result, before the review's presence results on that set were seen; the commit history shows the order. The parts asked were visible to the labeller; whether the review found them was not.
- **Rounds.** Tuned on the development set, frozen, tested on held-out set 1. Changed again after held-out set 1, frozen, tested on held-out set 2. Held-out set 2 is the only clean test of the final version.

## Results

| Version | Set | Parts asked | Really required | Presence right | False "present" | False "missing" |
|---|---|---|---|---|---|---|
| v2 (credence-tuned) | development | 24 | 15 | 15 of 15 | 0 | 0 |
| v3 | development | 15 | 15 | 15 of 15 | 0 | 0 |
| v3 | held-out 1 | 23 | 20 (+2 required but not asked) | 18 of 20 | 0 | 2 |
| v4 | development | 15 | 15 | 15 of 15 | 0 | 0 |
| v4 | held-out 1 | 22 | 22 | 22 of 22 | 0 | 0 |
| **v4** | **held-out 2 (clean test)** | **26** | **23** | **21 of 23** | **1** | **1** |

Output for each version: [`run-v3.json`](run-v3.json) and [`run-v4.json`](run-v4.json). The v2 row is from the first run, before any kibble change.

**What changed.**
- **v3**, from the development set. A number in a condition is not a number of items to give: "10 consecutive runs", "rounded to two decimals", "N>=2 jobs", "all three models". "SQL query" needs SQL or "the query", not "a sample query". "Hashes" needs a hash to be given, not the word `result_hash`.
- **v4**, from held-out set 1:
  - Named items are looked for by name, so "a table of 3 criteria (latency, persistence, ops complexity)" counts when the three are discussed in a table or a sentence.
  - Text pasted from the job is not evidence of any part. Many results paste the job back ("Verified execution for '…Success: 3 improvements…'"), and its wording would otherwise count.
  - "status" inside identifiers (`data.status`) and loose "pattern" wording no longer ask for a part.

**Errors left in the clean test.**
- **Optional parts read as required.** "a Figma link (or detailed markdown specification…)", "proof of command" only if self-generated, and "a failure-tolerance count" read as a message count.
- **One false "present".** Asked for 4 named UI states, a result about a different subject listed four numbered points.
- **One false "missing".** Asked for "the 2 most likely causes", a result named both in prose.

**Also tested.** [CRED-EXP-002](../2026-10-20-cred-exp-002/README.md) gives exactly the same results with v4 as before.

## Indicative only: what "useful" goes with

[`indicative.mjs`](indicative.mjs) ran over every kibble job ID whose success line names checkable parts and that has a result, in the archive from 05:32 to 15:02 UTC on 20 October: 3,803 job IDs. Run later, over more of the day, it will give somewhat different counts.

| | Job IDs | No result contains every part |
|---|---|---|
| Called useful by a key other than a result's author | 532 | 255 (48%) |
| Not called useful by another key | 3,271 | 2,250 (69%) |

A "useful" verdict does go with more complete results, but about half of them land on jobs where no result has all the parts the job asks for. With the error rates above, the direction and rough size are worth stating; a precise figure is not. Kibble job IDs are often shared by several postings of the same title (see [the reused-ID finding](../2026-10-20-kibble-reused-job-ids/README.md)). An independent review asked whether a result could be checked against another posting's requirements. In this data it cannot: none of the 15,712 job IDs had postings with different success lines. Since evidence review v5, an ID whose postings differ gets no required parts at all, and the figure above is unchanged. A result may still have been written for one particular posting, which this does not establish. This figure is not shown in the app or the daily digest.

## What Proofline does with this

- **In the app.** The evidence review keeps showing, per result, each part the job asks for and whether the text contains it. The caption says these are text checks and gives the measured error rate. There is no verdict built on them.
- **Not built.** No daily-digest number. A version accurate enough for that would need parts that can be checked mechanically (a URL that resolves, a command that runs, SQL that parses), or a reader.

## Reproduce

```sh
git clone https://github.com/wyc4t/proofline-technocore && cd proofline-technocore
git clone --branch archive-data --single-branch https://github.com/wyc4t/proofline-technocore archive-data
gh release download kibble-2026-10-20 -R wyc4t/proofline-technocore -D assets
node findings/2026-10-20-kibble-exp-001/reproduce.mjs --data archive-data --assets assets
node findings/2026-10-20-kibble-exp-001/indicative.mjs --data archive-data --assets assets
```

The numbers above are from evidence review v4. v5 (after an independent review: how each part was found, and job IDs whose postings differ are not checked) gives identical results on all three sets and the same indicative figure. The release grows during the day, so download it after 21 October for the full day; the labelled cases are all early enough to be present either way.
