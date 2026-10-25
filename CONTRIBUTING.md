# Contributing to Proofline

Bug reports, unclear explanations, independent reproductions and focused pull
requests are welcome. You can contribute without a wallet or a Technocore DID.
Proofline is a community research prototype, not an official FLOP Labs product.

## Suggest an improvement or report a bug

[Open an issue](https://github.com/wyc4t/proofline-technocore/issues/new) after
checking existing issues. GitHub requires an account; browsing the app does not.

Describe what you tried, what you expected and what you observed. For an evidence
problem, include a public pinned-case link, the relevant sequence numbers, and
your browser if signature verification or layout is involved. A screenshot or
exact reproduction steps help. Feature proposals should explain the reader's
problem and one concrete example.

Public messages and links can identify their authors. Share only material you
intend to make public. Never include private keys, seed phrases, identity files,
passphrases, API keys or private correspondence.

## Reproduce or challenge a finding

Start with the finding's stated window, manifest and commands in `findings/`.
Record the code revision, evidence hashes, method, raw result and limitations.
Explain whether a difference comes from changed inputs, code or an invalid
method. Negative results and corrections are useful contributions.

A valid signature proves that a key signed room, nonce and text. It does not
prove task quality or real-world identity. A complete protocol chain does not
establish correct work, independent participants or settlement. Preserve those
distinctions in code, copy and reports. Describe observable behavior neutrally.

## Make a focused pull request

Fork the repository and keep each change focused on one reader problem. Explain
the resulting behavior and the checks you ran. Maintainer review is required
before a contribution is merged.

Use Node 22. The core test and build checks do not need network access:

```sh
npm run build
npm test
npm run check
```

JavaScript source lives in `src/`; `dist/app.js` is generated. Commit the rebuilt
bundle when changing that source. Static pages and styles are maintained directly
in `dist/`. Keep narrow-screen layouts, keyboard access and text-only rendering
of public messages working. If you change an evidence interpretation, include a
meaningful fixture or regression test. The guided examples are checked against
preserved public records.

The share-card function uses the dependencies declared in `package.json`; local
work on that function also requires installing them. Credentials and deployment
access are not required for ordinary contributions.

Proofline reads public data. Do not add room writes, identity collection,
unnecessary polling or telemetry without discussing the purpose and scope first.
Use local fixtures for boundary tests; never stress a public service.

## License

Proofline is licensed under Apache-2.0. Contributions are submitted under that
license. See `LICENSE` and `NOTICE`.
