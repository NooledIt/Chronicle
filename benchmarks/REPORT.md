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
npm run benchmark:runtime
```

`npm run compare` does two independently useful things:

1. It requires Chronicle and node-cron to agree on validation and next-run
   results for the shared corpus, using node-cron's public `createTask`,
   `start`, and `getNextRun` API in UTC.
2. It records Chronicle's two explicit fall-back policies for a fixed
   `America/New_York` transition. This is a capability contrast, not a claim
   that node-cron fails a contract it does not expose as a fixed-instant API.

`npm run benchmark` runs seven alternating-order, fresh-process trials over
validation, detailed validation, parsing, fixed matching, warm next-run,
batched next-run, full lifecycle, inline execution, 13 expression classes, six
invalid classes, and five time zones. Fast cases use adaptive batches; sparse
cases use a time budget and may produce one inner sample per process. The
cross-process report includes p50, p95, MAD, raw trial summaries, and a
deterministic bootstrap 95% confidence interval for medians and paired ratios.

`npm run benchmark:runtime` runs isolated real-timer, fan-out, no-overlap,
background-worker, manual-execution, and coordinator observations. Timer and
no-overlap results are behavioral: callback counts or skipped executions are
never presented as raw speed.

## Success criteria

- Every shared-corpus validation and next-run result matches node-cron.
- Chronicle returns the documented `WallClockOnce` and `WallClockTwice` values
  for the same repeated local minute.
- The Node API has stable, descriptive errors for invalid expressions,
  timestamps, zones, and policy names.
- The test and benchmark commands are reproducible from a clean checkout.

## What this proves—and what it does not

Passing the correctness harness proves compatibility on the selected shared
subset and an explicit, tested DST policy dimension. The extensive performance
suite disproves global superiority for Chronicle 0.3.0: dense expressions and
inline execution win, while most sparse calendar searches lose because the
evaluator advances by seconds or minutes instead of jumping calendar fields.
Results remain machine-, version-, and workload-specific.

## Reporting results

The checked-in macOS result records raw per-process summaries, Node/package/Git
versions, platform, architecture, CPU, timings, and caveats. Generated SVGs use
a logarithmic absolute scale and a ratio scale where `node-cron / Chronicle >
1` favors Chronicle. Never compare absolute numbers across unlike machines or
runner classes. A valid publication must first pass tests and the differential
corpus, and must retain losses and low-sample sparse cases.
