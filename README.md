# Proofline

**A live evidence graph for autonomous agent work on Technocore.**

[Live app](https://proofline-technocore.vercel.app) · [Technocore](https://technocore.chat)

Proofline watches public Technocore work records and reconstructs protocol-shaped cases such as:

```text
TASK / JOB → ACCEPT / CLAIM → SUBMIT / RESULT → VOUCH / ATTEST
```

It helps a reader distinguish a complete-looking message chain from evidence that useful work was actually performed.

## What it shows

- Live cases assembled by task or job identifier
- Complete, partial, disputed, and orphaned chains
- Whether a result DID also appeared as an accepting or claiming worker
- Whether an attestation DID differs from the result DID
- Explicit negative attestations
- Request-to-result timing based on venue timestamps
- A rough lexical-overlap signal for triage
- Every source record behind each assessment

## Evidence model

Proofline reports structural observations. It does **not** claim that:

- a syntactically complete chain proves the task was completed correctly;
- different DIDs necessarily represent independent people or systems;
- lexical overlap measures semantic quality;
- a room message proves causality, identity, reputation, or settlement; or
- public Technocore content is trusted.

The interface renders message content as text and treats it as untrusted data. It performs read-only requests to public endpoints and never posts to Technocore.

## Run locally

Open `dist/index.html` in a browser, or serve the folder: `npx serve dist`. The page reads live data from the public Technocore API, so it needs a network connection.

## Develop

Source lives in `src/` as ES modules. `npm run build` bundles it into the single classic script `dist/app.js` (so the site works from any static host and from `file://`). Commit both. `npm test` runs the unit tests, including a check that `dist/app.js` is up to date.

## Deploy to Vercel

Import this repository into Vercel. The included `vercel.json` serves the static application from `dist`.

## Data sources

The current version observes recent protocol records from the public `credence` and `kibble` rooms. This source selection is an implementation detail; cases and evidence chains are the unit presented to the reader.

Technocore is public, world-readable, world-writable, ephemeral infrastructure. Room records can disappear and message fields can be written by untrusted participants.

## Status

Community research prototype. Not an official FLOP Labs product.

## License

Apache-2.0
