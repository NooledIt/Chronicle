# Chronicle 0.3.0 vs. node-cron 4.6.0

**Measured:** 2026-07-30 on an Apple M2 Pro, macOS 26.5.2
(`darwin-arm64`), Node.js 26.0.0, Chronicle 0.3.0, and node-cron 4.6.0.

## Decision summary

Chronicle is not uniformly 13-16x faster. The extensive suite contains 132
comparable public API/workload pairs: Chronicle won 37 and node-cron won 95.
Chronicle is strongest for every-second/stepped next-run calculations and
inline task execution. node-cron is substantially faster for most sparse
calendar searches, parsing/validation, and timezone next-run calculations.

The original result was real but narrow: an every-15-minutes Chronicle
fixed-after call was compared with node-cron's closest public lifecycle path.
The new suite compares like-named public task operations, uses 13 expression
classes and five zones, and keeps Chronicle-only fixed-after results out of the
ratios.

## Result overview

The ratio is `node-cron p50 / Chronicle p50`. Values above 1 favor Chronicle;
values below 1 favor node-cron.

| Public API suite | Compared cases | Chronicle wins | node-cron wins | Median case ratio |
| --- | ---: | ---: | ---: | ---: |
| Inline manual execution | 13 | 13 | 0 | 7.762x |
| Warm `getNextRun()` | 13 | 2 | 11 | 0.006x |
| Warm `getNextRuns(10)` | 13 | 2 | 11 | 0.004x |
| Full create/start/next/stop/destroy lifecycle | 13 | 2 | 11 | 0.008x |
| Fixed-date task match | 13 | 1 | 12 | 0.793x |
| Valid parse | 13 | 2 | 11 | 0.002x |
| Valid validation | 13 | 2 | 11 | 0.002x |
| Detailed valid validation | 13 | 2 | 11 | 0.002x |
| Invalid parse/validation variants | 18 | 11 | 7 | mixed |
| Timezone warm next-run | 5 | 0 | 5 | 0.184x |
| Timezone fixed match | 5 | 0 | 5 | 0.801x |
| **Total** | **132** | **37** | **95** | — |

![All comparable suite/workload ratios](benchmark-results/ratio-heatmap.svg)

## Warm next-run latency

These cases pre-create and start one task per implementation, then measure the
public `getNextRun()` call. Both tasks use `timezone: "UTC"`; the calculation
uses the live clock.

![Absolute warm next-run p50 and p95 latency](benchmark-results/latency-log.svg)

![Warm next-run node-cron-to-Chronicle ratios](benchmark-results/latency-ratio.svg)

| Expression class | Chronicle p50 (us) | node-cron p50 (us) | Paired median ratio | Assessment |
| --- | ---: | ---: | ---: | --- |
| Every second | **6.438** | 97.396 | 14.854x | Chronicle win |
| Every 15 minutes | **11.286** | 22.896 | 2.050x | Chronicle win |
| Daily at 09:00 | 115.083 | **23.336** | 0.199x | node-cron win |
| Last day of month | 310.709 | **21.997** | 0.071x | node-cron win |
| Nearest weekday | 4,723.125 | **28.156** | 0.006x | node-cron win |
| Named month/day/range | 10,597.084 | **25.604** | 0.002x | node-cron win |
| Wrapped month/hour/day ranges | 29,748.458 | **32.708** | 0.001x | node-cron win |
| Yearly | 49,043.750 | **40.229** | 0.00082x | node-cron win |
| Leap day | 183,491.458 | **89.344** | 0.00049x | node-cron win |

The mechanism is visible in `Schedule::next_after`: Chronicle increments a
candidate by one second for six-field schedules or one minute for five-field
schedules until every field matches. This is efficient for nearby dense
matches but grows linearly with distance. node-cron jumps calendar fields, so
it dominates sparse expressions. Chronicle needs a field-jumping evaluator
before a broad next-run performance claim is credible.

## Real scheduling observations

The runtime suite executes each library/scenario pair in a fresh process with
watchdogs and full task cleanup. It is deliberately separate from the
seven-trial CPU/API suite.

| Scenario | Chronicle | node-cron | Interpretation |
| --- | ---: | ---: | --- |
| Single task, second-boundary phase | 1 ms | 3 ms | Both delivered 2/2 callbacks |
| 100-task fan-out, second-boundary phase | 5 ms | 14 ms | Both delivered 200/200 callbacks |
| Inline execute throughput | 297,154 ops/s | 37,799 ops/s | Chronicle 7.86x higher |
| Background cold total | 90.497 ms | 105.634 ms | Chronicle 1.17x lower |
| Background warm IPC | 17,900 ops/s | 6,751 ops/s | Chronicle 2.65x higher |
| Coordinator allow | 2 decisions, 2 callbacks | 2 decisions, 2 callbacks | Contract matched |
| Coordinator deny | 2 decisions, 2 skips | 2 decisions, 2 skips | Contract matched |

The timer cases contain only two scheduled slots and therefore establish
delivery/behavior, not stable tail latency. In the five-slot 1.5-second
`noOverlap` case, both implementations kept maximum concurrency at one;
node-cron emitted two overlap events while Chronicle emitted none. Chronicle
rearms its timer after an awaited callback, whereas node-cron maintains a
heartbeat and reports skipped overlaps. Applications may care about that
semantic difference more than throughput.

## Compatibility evidence

The differential corpus covers five/six fields, literals, lists, ranges,
steps, names, advanced calendar tokens, wrapped ranges, and invalid forms.

| Area | Chronicle 0.3.0 | node-cron 4.6.0 | Assessment |
| --- | --- | --- | --- |
| Core and advanced grammar | Five/six fields plus `L`, `L-n`, `W`, `LW`, `#`, `?`, and wrapped ranges | Same tested surface | Shared corpus matches |
| Timezone behavior | IANA zones and fixed-instant evaluator | Task timezone | Shared task cases use explicit UTC |
| DST repeated hour | Caller chooses once or twice | Documents one execution | Chronicle exposes an additional policy |
| Lifecycle | Start/stop/destroy/status, overlap guard, jitter, run limit | Equivalent core controls | Near parity |
| Background modules | Persistent isolated child process | Isolated background task | Both pass runtime checks |
| Distributed coordination | Caller-provided coordinator | Caller-provided coordinator | Allow/deny contract passes; multi-host contention is not benchmarked |
| Durability | No job persistence or durable retry queue | Same product category | Neither replaces a durable queue |

## Method and statistical boundaries

- Seven trials; one fresh child process per library per trial; library order
  alternates.
- `process.hrtime.bigint()` timing with adaptive batches and a time budget.
- Aggregates report median process p50/p95, median absolute deviation, raw
  trial values, and deterministic bootstrap 95% confidence intervals.
- Sparse cases may contain one inner measurement per process because a single
  operation exceeds the inner time budget. Cross-process trial count remains
  seven and is visible in the raw data.
- Chronicle-only `nextOccurrence(expression, after)` results are retained but
  marked non-comparable because node-cron has no public fixed-after API.
- Validation is not internally equivalent: Chronicle validates by finding an
  occurrence, while node-cron performs conversion-oriented validation.
- Results apply to this machine, runtime, versions, expressions, and public
  API paths. They do not establish universal product superiority.

## Reproduction and evidence

```bash
cd node
npm ci
npm run build
npm test
npm run compare
npm run benchmark -- --runs 7 \
  --output ../benchmarks/results/macos-arm64-v0.3.0-extensive.json
npm run benchmark:runtime -- \
  --output ../benchmarks/results/macos-arm64-v0.3.0-runtime.json
node ../benchmarks/render-report.cjs \
  --input ../benchmarks/results/macos-arm64-v0.3.0-extensive.json \
  --runtime ../benchmarks/results/macos-arm64-v0.3.0-runtime.json \
  --output-dir ../docs/benchmark-results
```

- [Generated warm next-run summary](benchmark-results/summary.md)
- [Raw seven-trial CPU/API evidence](../benchmarks/results/macos-arm64-v0.3.0-extensive.json)
- [Raw runtime evidence](../benchmarks/results/macos-arm64-v0.3.0-runtime.json)
- [Benchmark protocol](../benchmarks/REPORT.md)
