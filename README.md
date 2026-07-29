# Chronicle

Chronicle is a deterministic cron-occurrence engine focused on a failure-prone
part of scheduling: interpreting wall-clock schedules across timezone and
daylight-saving transitions.

The current release is a Rust core library. It evaluates a schedule to the
first matching instant strictly after an input instant, either in UTC or an
IANA timezone.

## Why Chronicle

Many schedulers leave the repeated hour at daylight-saving fall-back implicit.
Chronicle makes it a deliberate API choice:

- `DstPolicy::WallClockOnce` runs the earlier occurrence only.
- `DstPolicy::WallClockTwice` runs both occurrences.
- A nonexistent local minute during spring-forward is skipped.

These behaviors are covered by fixed transition tests for `America/New_York`,
alongside property tests and an independent JSON conformance corpus.

## Supported grammar

Chronicle currently supports five cron fields:

```text
minute hour day-of-month month day-of-week
```

Each field accepts:

- `*` — any value
- An integer in the field's range
- `*/N` — a step from the field's minimum value

The ranges are minute `0-59`, hour `0-23`, day-of-month `1-31`, month `1-12`,
and day-of-week `0-6` (`0` is Sunday). All fields must match, including
day-of-month and day-of-week.

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

The test suite includes:

- JSON conformance fixtures for UTC schedules;
- fixed DST transition cases;
- generated property tests for occurrence ordering and field constraints;
- malformed-input regression tests.

## Node API (local addon)

The `node/` package exposes the native core to Node.js through N-API. Build it
locally before use:

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

## Current limitations

Chronicle is intentionally not yet a drop-in replacement for mature Node cron
packages. It does not currently support ranges, lists, named fields, six-field
seconds, job execution, persistence, retries, or distributed coordination. It
now includes a local Node native addon, but it is not yet packaged for
cross-platform npm distribution. The project includes a bounded differential
harness against `node-cron`; see [the benchmark protocol](benchmarks/REPORT.md)
for what that comparison does and does not prove.

## License

Chronicle is released under the [MIT License](LICENSE).
