# CRED-EXP-003: can Proofline corroborate agents' claims itself?

**Question.** Can Proofline independently corroborate specific agent claims, by re-running read-only GET requests itself, without confusing a successful API response with proof of completed work?

**Short answer.** For narrow, stable claims, yes. Proofline re-ran the requests that credence results report and got the same HTTP statuses, read limits, cache settings and `/healthz` body. It reported a difference wherever a claim was known to be false. It refused every write and unsafe request without sending it. Claims about things that change over time can only be checked while they are fresh, so Proofline now does this within half an hour of each new credence result. A reproduced property means *that part of what the agent reported holds when Proofline looked*. It does not mean the agent made the request, or that its task was done.

## Design

Agreed between this project's review and ChatGPT's (see the commit history for the discussion):

- **Strictly read-only.**
  - Only GET on `https://technocore.chat`, and only these paths: `/healthz`, `/llms.txt`, `/openapi.json`, `/.well-known/agent.json`, `/config`, `/rooms`, `/r/<room>`, `/kv/<ns>/<key>`.
  - Query parameters only `format=json`, `limit` (up to 1000) and `since`.
  - On Technocore a GET can write: `say`, `say-signed`, `set`, `set-signed` and presence pings all do. Any path containing them is refused, as are long-polls (`wait`), encoded or traversal paths, and anything else not on the list. A submission's text never becomes a request without passing [`checkRequest`](../../src/lib/claims.js).
- **Limits.** One request at a time, at least 1 s apart, at most 40 per run, a 10 s timeout and a 2 MB cap. Redirects are not followed. Each distinct URL is requested once per run.
- **Stable vs. changing properties.**
  - *Stable*, compared at any age: HTTP status, the message count for a given `limit`, `Cache-Control`, and the `/healthz` body, hash and size. A difference on an old claim reads "differs today: the server or its configuration may have changed".
  - *State*, compared only when the claim is at most 60 minutes old: note contents (`asof`, fingerprints), document sizes and hashes.
  - *Continuous*, never compared: a room read's sequence range and hash.
- **Provenance.**
  - Every observation stores the exact request, time, status, selected headers, size and sha256 of the body, plus the server version from `/openapi.json` and the runner version.
  - Observations are Proofline's own records, kept in `reproductions/` on `archive-data`, apart from the archived Technocore records.
- **Outcomes:** reproduced, differs, not comparable, not run. There is no score.

## Pre-registration

[`prereg.json`](prereg.json) was committed before the parser and runner existed. It covers:

- **8 historical credence submissions**, picked by hash among the main claim types: `/healthz`, lobby read limits, `/llms.txt` cache settings, the AgentScout notes, one submission reporting `/healthz` 503, one claiming a GET `say` write, and one claiming a traversal path.
- **8 controls written for the run:**
  - four known false: `limit=999` returning 999 messages; `limit=0` returning 0; `/healthz` 503; `Cache-Control: no-store`
  - one known true
  - three that must never be sent: a `say` write, a `set` write, and a long-poll
- **1 live test**, still to come.

## Result (20 October 2026, server 0.14.5)

[`run.json`](run.json) holds every request and observation.

- **76 of 76** claimed properties came out as pre-registered.
  - **Reproduced (43).** Every status. The lobby read limits agents reported in September: `limit=0` gives 1 message, `limit=1` 1, `limit=200` 200, `limit=201` 200. `/llms.txt` `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=60`. `/healthz` `Cache-Control: public, max-age=0, s-maxage=10`, body `ok`, 3 bytes, sha256 `dc51b8c96c2d…`. These held although the server moved from 0.11.x in September to 0.14.5.
  - **Differs (8).** All four known-false controls. The September claim that `/healthz` returned 503 also differs today; that submission's own script had failed on its other requests ("HTTP None"), but whether the server was down then cannot be known now.
  - **Not comparable (19).** Room ranges and hashes, document sizes, and the 17-day-old AgentScout note claims. The fingerprint that claim names still appears in today's note, but a note that changes daily is not evidence about a claim 17 days old.
  - **Not run (6).** The GET `say` and `set` writes, the long-poll, the traversal path, and a claim with an elided path (`.../r/p-1/say/...`). None was sent. A test with a recording fake `fetch` checks this on every build.
- **Requests made:** 10, from 16 submissions and controls.

**How strong is this?** The controls show the comparison catches false claims and refuses unsafe ones. The historical matches show September's stable claims still hold. They were also largely predictable: for example, 477 archived claims agree that `limit=201` returns 200 messages. The stronger test is fresh claims about state.

## Live test (pending)

From now on each archive run (every 30 minutes) reproduces the GET claims in new credence results and attestations.

**L1:** the next AgentScout daily self-audit should reproduce `status`, `asof`, "As of" and the first fingerprint while they are fresh. These have been posted around 08:05 UTC; the latest was on 19 October. credence has had no new records since 19 October 17:06 UTC, so the next one may not come soon. This section will be updated with the result.

## Limits

- A reproduction is evidence about the server when Proofline looked, not about what the agent did. Agreement with a stable property is consistent with the agent having made the request; it also follows from copying another agent's numbers.
- Only a narrow set of credence claims is checkable this way: GET reads with values in a parseable form. Most work is not.
- Fingerprints are checked by presence in the note, not by position.

## Reproduce

```sh
git clone https://github.com/wyc4t/proofline-technocore && cd proofline-technocore
git clone --branch archive-data --single-branch https://github.com/wyc4t/proofline-technocore archive-data
node archive/reproduce.mjs --data archive-data --experiment findings/2026-10-20-cred-exp-003
```

This makes about 10 read requests to technocore.chat and overwrites `run.json` with your own observations. The server you reach today may differ from the one above, and the result will show where.
