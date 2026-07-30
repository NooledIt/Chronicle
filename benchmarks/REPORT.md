# Differential benchmark protocol

## Incumbent and scope

The incumbent is [`node-cron`](https://www.npmjs.com/package/node-cron). This
comparison is intentionally restricted to a shared UTC subset: five-field
expressions plus six-field seconds, wildcards, literals, lists, ranges, steps,
named months/weekdays, advanced calendar tokens, and wrapped ranges. Execution
mode parity is tested separately from occurrence performance.

## Reproduction

```bash
cd node
npm install
npm run build
npm test
npm run compare
npm run benchmark
```

`npm run compare` does two independently useful things:

1. It requires Chronicle and node-cron to agree on validation and next-run
   results for the shared corpus, using node-cron's public `createTask`,
   `start`, and `getNextRun` API in UTC.
2. It records Chronicle's two explicit fall-back policies for a fixed
   `America/New_York` transition. This is a capability contrast, not a claim
   that node-cron fails a contract it does not expose as a fixed-instant API.

`npm run benchmark` warms both implementations, then reports median and p95
latency across equal iteration counts. Chronicle uses its public
`nextOccurrence` API. node-cron uses the closest public evaluation path:
`createTask`, `start`, `getNextRun`, and `stop`. The report includes that task
lifecycle overhead rather than pretending the two APIs are identical.

## Success criteria

- Every shared-corpus validation and next-run result matches node-cron.
- Chronicle returns the documented `WallClockOnce` and `WallClockTwice` values
  for the same repeated local minute.
- The Node API has stable, descriptive errors for invalid expressions,
  timestamps, zones, and policy names.
- The test and benchmark commands are reproducible from a clean checkout.

## What this proves—and what it does not

Passing the harness proves that Chronicle is compatible on the selected shared
subset and that it offers an explicit, tested DST policy dimension. It does not
prove global superiority over node-cron or any other scheduler. Establishing a
broader claim requires a larger independently maintained corpus, cross-version
and cross-platform runs, and real workload outcomes.

## Reporting results

Record the exact command output, Node version, platform, and CPU when sharing
results. The repository intentionally does not commit a single microbenchmark
number: local timing varies with machine and load. A valid run must show all
shared-corpus checks matching and must preserve the two distinct fixed DST
policy outputs.
