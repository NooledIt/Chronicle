# Contributing to Chronicle

Thank you for improving Chronicle. Before changing code, open an issue or a
proposal for behavior that changes the public schedule contract.

## Local checks

```bash
cargo test --workspace
cd node
npm ci
npm run build
npm test
npm run compare
npm run benchmark
```

Changes to parsing or occurrence semantics must add independent Rust fixtures
and, when node-cron has a comparable public API, a differential corpus case.
Do not treat a microbenchmark result as a general performance claim: include
the command, hardware, Node version, and API-comparability caveat.

## Pull requests

Keep each pull request narrow, explain the behavior change, and update the
contract and README when user-visible behavior changes. CI must pass on every
supported runner. For a release-sensitive change, state whether existing
schedule behavior changes.

## Issues and proposals

Use the GitHub bug and feature forms for actionable reports. Use
[`docs/proposals/template.md`](docs/proposals/template.md) for larger changes
to parser semantics, lifecycle behavior, persistence, or distribution. Include
acceptance criteria and a test plan.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
