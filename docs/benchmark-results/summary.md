# Benchmark evidence

> Lower latency is better. This report is generated from release benchmark JSON; do not compare values across different runner classes without noting the environment.

## Environment

- **Platform:** darwin
- **CPU:** Apple M2 Pro
- **Node:** v26.0.0
- **Git:** 49183b577d71e79e0c39ac89878d8443b256e39b
- **Native build:** release
- **Generated:** 2026-07-30T01:09:11.364Z

## Results

| Workload | Implementation | Trials (n) | Median (µs) | p95 (µs) | Ratio to workload baseline |
| --- | --- | ---: | ---: | ---: | ---: |
| getNextRun-warm: dense | chronicle | 7 | 1.905 | 2.217 | 1× |
| getNextRun-warm: dense | node-cron | 7 | 43.615 | 64.563 | 22.895× |
| getNextRun-warm: last-day | chronicle | 7 | 2.083 | 3.091 | 1× |
| getNextRun-warm: last-day | node-cron | 7 | 22.177 | 26.471 | 10.647× |
| getNextRun-warm: last-offset | chronicle | 7 | 2.322 | 2.858 | 1× |
| getNextRun-warm: last-offset | node-cron | 7 | 30.688 | 38.161 | 13.092× |
| getNextRun-warm: last-weekday | chronicle | 7 | 2.091 | 2.58 | 1× |
| getNextRun-warm: last-weekday | node-cron | 7 | 22.396 | 25.99 | 10.641× |
| getNextRun-warm: leap | chronicle | 7 | 2.974 | 3.737 | 1× |
| getNextRun-warm: leap | node-cron | 7 | 89.886 | 104.042 | 30.619× |
| getNextRun-warm: named | chronicle | 7 | 2.835 | 3.157 | 1× |
| getNextRun-warm: named | node-cron | 7 | 25.622 | 33.997 | 9.083× |
| getNextRun-warm: nearest-weekday | chronicle | 7 | 2.336 | 2.704 | 1× |
| getNextRun-warm: nearest-weekday | node-cron | 7 | 28.573 | 38.125 | 12.232× |
| getNextRun-warm: nth-weekday | chronicle | 7 | 2.395 | 3.009 | 1× |
| getNextRun-warm: nth-weekday | node-cron | 7 | 30.151 | 33.479 | 12.692× |
| getNextRun-warm: simple | chronicle | 7 | 2.042 | 2.882 | 1× |
| getNextRun-warm: simple | node-cron | 7 | 23.578 | 30.633 | 11.61× |
| getNextRun-warm: stepped | chronicle | 7 | 2.063 | 2.745 | 1× |
| getNextRun-warm: stepped | node-cron | 7 | 23.18 | 28.529 | 11.318× |
| getNextRun-warm: weekday-last | chronicle | 7 | 2.116 | 2.835 | 1× |
| getNextRun-warm: weekday-last | node-cron | 7 | 22.99 | 27.966 | 11.011× |
| getNextRun-warm: wrapped | chronicle | 7 | 2.882 | 3.48 | 1× |
| getNextRun-warm: wrapped | node-cron | 7 | 32.635 | 44.505 | 11.295× |
| getNextRun-warm: yearly | chronicle | 7 | 2.396 | 3.462 | 1× |
| getNextRun-warm: yearly | node-cron | 7 | 39.979 | 52.734 | 16.735× |

## Comparability caveat

All shared task workloads explicitly use UTC because node-cron otherwise uses host-local time while Chronicle defaults to UTC. Warm next-run APIs use the live clock; only task.match and Chronicle nextOccurrence receive fixed instants. Chronicle validation searches for an occurrence through its native evaluator; node-cron validation is conversion-oriented. Chronicle task.match evaluates nextOccurrence(date - 1ms); node-cron task.match invokes its matcher directly. Lifecycle measurements intentionally include task construction, timer setup, next-run calculation, teardown, and registry cleanup. Chronicle-only fixed-after metrics are marked non-comparable and excluded from ratios.

Artifacts: `latency-log.svg` shows absolute p50/p95 values on a log scale. `latency-ratio.svg` centers the selected baseline at 1× on a symmetric log scale.
