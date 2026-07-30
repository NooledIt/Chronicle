# 🕰️ Chronicle

[![CI](https://github.com/noolinc/Chronicle/actions/workflows/ci.yml/badge.svg)](https://github.com/noolinc/Chronicle/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/noolinc/Chronicle?label=release)](https://github.com/noolinc/Chronicle/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](node/package.json)
[![Rust stable](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](Cargo.toml)

Chronicle is a `node-cron`-compatible scheduler with deterministic occurrence
queries, explicit daylight-saving policies, isolated background workers,
distributed-coordination hooks, and a fast native Rust scheduling engine.

For the common Node scheduling API, switching packages is normally one changed
import:

```bash
npm install @nool/chronicle
```

```js
// Before: const cron = require('node-cron')
const cron = require('@nool/chronicle')

const task = cron.schedule('*/5 * * * *', refreshCache, {
  timezone: 'UTC',
  noOverlap: true,
})
```

Chronicle supports `schedule`, `createTask`, `validate`, task registry access,
and the familiar start/stop/destroy lifecycle. See [Migration and
compatibility](#migration-and-compatibility) for the exact boundary.

## Why Chronicle

Chronicle can be used as both a cron runner and a deterministic scheduling
primitive. That makes several workflows possible without building a separate
calendar engine around a scheduler:

- **Forecast from an exact instant.** `nextOccurrence(expression, after)` can
  preview billing dates, generate schedule calendars, replay missed windows,
  and test leap-day behavior without changing the system clock.
- **Choose DST behavior explicitly.** `wallClockOnce` runs the earlier instant
  in a repeated fall-back hour; `wallClockTwice` runs both. Nonexistent local
  times during spring-forward are skipped.
- **Express operational calendars directly.** Chronicle supports `L`, `L-n`,
  `W`, `LW`, `#`, weekday `L`, `?`, and wrapped ranges such as `22-2` and
  `Fri-Mon`.
- **Isolate job code.** A background task path runs in a persistent child
  process instead of sharing the scheduler process.
- **Coordinate replicas.** A caller-provided lease coordinator can elect one
  runner across application instances; Chronicle fails closed when election
  fails.
- **Scale scheduling-heavy workloads.** The native evaluator substantially
  reduces next-run and lifecycle overhead in the recorded macOS benchmark.

These behaviors are covered by fixed timezone-transition tests, property
tests, an independent JSON conformance corpus, and a differential suite against
`node-cron`.

## Performance compared with node-cron

After replacing linear time scanning with calendar-field jumps, Chronicle won
**128 of 132 comparable public API/workload pairs**. It won all **114 valid
scheduling/API pairs**; the four remaining losses are invalid-input validation
and error-detail paths. Lower latency is better.

![Warm next-run latency ratios; values to the right of 1x favor Chronicle](docs/benchmark-results/latency-ratio.svg)

| Warm `getNextRun()` workload | Chronicle p50 | node-cron p50 | Result |
| --- | ---: | ---: | --- |
| Every second, `* * * * * *` | **1.905 us** | 43.615 us | Chronicle 22.90x faster |
| Every 15 minutes, `*/15 * * * *` | **2.063 us** | 23.180 us | Chronicle 11.32x faster |
| Daily at 09:00 | **2.042 us** | 23.578 us | Chronicle 11.61x faster |
| Nearest weekday, `15W` | **2.336 us** | 28.573 us | Chronicle 12.23x faster |
| Yearly | **2.396 us** | 39.979 us | Chronicle 16.74x faster |
| Leap day | **2.974 us** | 89.886 us | Chronicle 30.62x faster |

All 13 warm next-run workloads favored Chronicle, ranging from 9.08x to
30.62x with an 11.61x median ratio. Chronicle also won all 13 inline
manual-execution workloads, with a 7.72x median suite ratio. In the real-timer
observation, both implementations delivered every expected callback through
100-task fan-out; Chronicle's median phase after the second boundary was 3 ms
versus node-cron's 7 ms at 100 tasks.
Those timer values cover only two scheduled slots and are behavioral evidence,
not a stable latency estimate.

The evaluator now jumps directly across disallowed months, hours, minutes, and
seconds while checking at most the relevant calendar dates. An independent
brute-force oracle covers 192 deterministic schedules, and DST tests include
real-instant ordering inside a repeated hour. The [complete comparison
report](docs/comparison-report.md), [all-workload
heatmap](docs/benchmark-results/ratio-heatmap.svg), [raw seven-trial CPU/API
data](benchmarks/results/macos-arm64-main-49183b5-extensive.json), and [runtime
observations](benchmarks/results/macos-arm64-main-49183b5-runtime.json)
preserve the complete evidence, including the four invalid-input losses.

The measurements used seven fresh-process trials with alternating library
order on an Apple M2 Pro, macOS 26.5.2 arm64, Node.js 26.0.0, Chronicle commit
`49183b5` (package manifest 0.3.0, release-native build), and node-cron 4.6.0.
All shared task cases explicitly use UTC. Reproduce from `node/` with `npm ci`,
`npm run build:release`, `npm test`, `npm run compare`, and
`npm run benchmark -- --runs 7`. See the [benchmark protocol](benchmarks/REPORT.md)
for confidence intervals, API differences, and interpretation boundaries.

## Supported grammar

Chronicle supports the standard five-field form and an optional leading
seconds field:

```text
[second] minute hour day-of-month month day-of-week
```

Each field accepts:

- `*` — any value
- An integer in the field's range;
- comma-separated lists (`1,5,9`), inclusive ranges (`9-17`), and steps over
  a wildcard or range (`*/15`, `9-17/2`);
- three-letter or full English month and weekday names (`Jan`, `September`,
  `Mon`, `Friday`);
- wrapping ranges (`22-2`, `Fri-Mon`), `L`/`L-n`, nearest weekdays (`15W`,
  `LW`), nth/last weekdays (`Mon#2`, `5L`), and `?` in either day field.

The ranges are second/minute `0-59`, hour `0-23`, day-of-month `1-31`, month
`1-12`, and day-of-week `0-7` (`0` and `7` are Sunday). With five fields,
seconds are implicitly `0`. All fields must match, including day-of-month and
day-of-week.

## Example

```rust
use chrono::{TimeZone, Utc};
use chrono_tz::America::New_York;
use chronicle_core::{DstPolicy, Schedule};

let schedule = Schedule::parse("30 1 * * *")?;
let after = Utc.with_ymd_and_hms(2026, 11, 1, 5, 30, 0).unwrap();
let next = schedule.next_after_in_timezone(
    after,
    New_York,
    DstPolicy::WallClockTwice,
)?;

assert_eq!(next.to_rfc3339(), "2026-11-01T06:30:00+00:00");
# Ok::<(), chronicle_core::CronError>(())
```

## Development

Requires a current Rust toolchain.

```bash
cargo test --workspace
```

GitHub Actions runs the Rust and Node suites on macOS (Intel and Apple
Silicon), Linux, and Windows. Publishing a GitHub Release rebuilds each native
addon, attaches loader-named platform binaries, SHA-256 checksums, and a macOS
benchmark report, and publishes the configured platform packages plus
`@nool/chronicle` when the npm publishing secret is available. The main package
selects the matching macOS, Linux, or Windows binding through npm optional
dependencies. See [the benchmark protocol](benchmarks/REPORT.md) for the scope
and interpretation of the results.

Maintainers publish a release through the **Mark a release** GitHub Actions
workflow. It uses the repository-scoped `GITHUB_NOOL_PUBLIC_TOKEN` secret to
create the release; the `release.published` workflow then builds and attaches
the binaries, checksums, and benchmark evidence.

The test suite includes:

- JSON conformance fixtures for UTC schedules;
- fixed DST transition cases;
- generated property tests for occurrence ordering and field constraints;
- malformed-input regression tests.

## Node API development

The published package exposes the native core to Node.js through N-API. When
working from a source checkout, build the addon locally before use:

```bash
cd node
npm install
npm run build
```

```js
const { nextOccurrence } = require('./node')

nextOccurrence('*/15 * * * *', '2026-01-15T09:01:00Z')
// '2026-01-15T09:15:00Z'

nextOccurrence('30 1 * * *', '2026-11-01T05:30:00Z', {
  timezone: 'America/New_York',
  dstPolicy: 'wallClockTwice',
})
// '2026-11-01T06:30:00Z'
```

`timezone` accepts an IANA zone. `dstPolicy` is `wallClockOnce` by default and
may also be `wallClockTwice`.

For in-process jobs, Chronicle also provides a small lifecycle wrapper:

```js
const { schedule } = require('./node/scheduler')

const task = schedule('*/5 * * * *', refreshCache, {
  timezone: 'UTC',
  noOverlap: true,
  maxExecutions: 12,
  maxRandomDelay: 30_000,
  name: 'cache-refresh',
})
```

Tasks support `start`, `stop`, `destroy`, `execute`, `getStatus`, and
`getNextRun`. They emit `executed`, `overlap`, `error`, and `destroyed` events.

## Migration and compatibility

For the supported task surface, Chronicle has the same common entry points as
`node-cron`:

```bash
npm install @nool/chronicle
```

```js
const cron = require('@nool/chronicle')
const task = cron.schedule('*/5 * * * *', refreshCache, {
  timezone: 'UTC', noOverlap: true,
})
```

`schedule`, `createTask`, `validate`, `validateDetailed`, `parse`, task
registry access, and shutdown are included. Background module paths execute in
an isolated child process. Distributed jobs accept `distributed`,
`runCoordinator`, and `distributedLease` options and fail closed when election
fails.

Run the existing application's tests when migrating, particularly around
events, timezone defaults, overlap handling, and background modules. Chronicle
is intentionally not a durable job queue: it does not persist jobs, retry work
after process failure, or provide its own distributed consensus service. See
the tested [feature-parity matrix](docs/feature-parity.md) for the precise
surface and non-goals.

## Built with Nool

Chronicle was built as an evaluation of [Nool](https://nool.dev), a semantic
version-control and task-orchestration tool. Rather than treating commits as
the only record of work, we used Nool to make each implementation step
traceable:

- Defined acceptance criteria for the UTC evaluator, timezone/DST behavior,
  property-based safety checks, documentation, and release hygiene.
- Announced intended file footprints and checked for conflicts before changes.
- Proposed and solidified each tested change as a semantic Knot, retaining its
  intent, affected paths, and validation evidence.
- Ran Nool's structural verification, release-health checks, and audit report
  before publishing the repository.

This process does not by itself prove Chronicle is better than an established
scheduler. It gives the project a reproducible causal record from requirement
to test to released change, which is the foundation for an independent quality
comparison.

See the measured, scope-bounded [Chronicle vs. node-cron evaluation
report](docs/comparison-report.md) for compatibility, DST behavior, and
additional macOS benchmark evidence.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull
request, and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Bug and feature
forms are available in GitHub Issues; design proposals use
[the proposal template](docs/proposals/template.md).

## Current limitations

Chronicle remains an in-memory scheduler: it does not persist jobs or provide
durable retries after process failure. Distributed coordination requires a
caller-provided coordinator such as a Redis-backed lease implementation. The
performance improvements apply to scheduler operations, not the runtime of the
jobs themselves; a long-running application callback does not become faster.
The bounded differential harness against `node-cron` is documented in [the
benchmark protocol](benchmarks/REPORT.md), including what the comparison does
and does not prove.

## License

Chronicle is released under the [MIT License](LICENSE).
