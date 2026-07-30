# Benchmark evidence

> Lower latency is better. This report is generated from release benchmark JSON; do not compare values across different runner classes without noting the environment.

## Environment

- **Platform:** darwin
- **CPU:** Apple M2 Pro
- **Node:** v26.0.0
- **Generated:** 2026-07-30T00:52:14.372Z

## Results

| Workload | Implementation | Trials (n) | Median (µs) | p95 (µs) | Ratio to workload baseline |
| --- | --- | ---: | ---: | ---: | ---: |
| getNextRun-warm: dense | chronicle | 7 | 6.438 | 7.092 | 1× |
| getNextRun-warm: dense | node-cron | 7 | 97.396 | 124.688 | 14.854× |
| getNextRun-warm: last-day | chronicle | 7 | 310.709 | 332.625 | 1× |
| getNextRun-warm: last-day | node-cron | 7 | 21.997 | 23.724 | 0.071× |
| getNextRun-warm: last-offset | chronicle | 7 | 9,109.833 | 9,109.833 | 1× |
| getNextRun-warm: last-offset | node-cron | 7 | 30.479 | 32.438 | 3.3e-3× |
| getNextRun-warm: last-weekday | chronicle | 7 | 310.916 | 338.875 | 1× |
| getNextRun-warm: last-weekday | node-cron | 7 | 22.466 | 24.013 | 0.073× |
| getNextRun-warm: leap | chronicle | 7 | 183,491.458 | 183,491.458 | 1× |
| getNextRun-warm: leap | node-cron | 7 | 89.344 | 105.469 | 4.9e-4× |
| getNextRun-warm: named | chronicle | 7 | 10,597.084 | 10,597.084 | 1× |
| getNextRun-warm: named | node-cron | 7 | 25.604 | 27.419 | 2.4e-3× |
| getNextRun-warm: nearest-weekday | chronicle | 7 | 4,723.125 | 4,723.125 | 1× |
| getNextRun-warm: nearest-weekday | node-cron | 7 | 28.156 | 31.177 | 6.0e-3× |
| getNextRun-warm: nth-weekday | chronicle | 7 | 6,025.208 | 6,025.208 | 1× |
| getNextRun-warm: nth-weekday | node-cron | 7 | 30.453 | 33.292 | 5.1e-3× |
| getNextRun-warm: simple | chronicle | 7 | 115.083 | 121.511 | 1× |
| getNextRun-warm: simple | node-cron | 7 | 23.336 | 25.763 | 0.199× |
| getNextRun-warm: stepped | chronicle | 7 | 11.286 | 11.923 | 1× |
| getNextRun-warm: stepped | node-cron | 7 | 22.896 | 26.49 | 2.05× |
| getNextRun-warm: weekday-last | chronicle | 7 | 310.541 | 335.791 | 1× |
| getNextRun-warm: weekday-last | node-cron | 7 | 23.318 | 25.815 | 0.075× |
| getNextRun-warm: wrapped | chronicle | 7 | 29,748.458 | 29,748.458 | 1× |
| getNextRun-warm: wrapped | node-cron | 7 | 32.708 | 37.26 | 1.1e-3× |
| getNextRun-warm: yearly | chronicle | 7 | 49,043.75 | 49,043.75 | 1× |
| getNextRun-warm: yearly | node-cron | 7 | 40.229 | 46.5 | 8.2e-4× |

## Comparability caveat

All shared task workloads explicitly use UTC because node-cron otherwise uses host-local time while Chronicle defaults to UTC. Warm next-run APIs use the live clock; only task.match and Chronicle nextOccurrence receive fixed instants. Chronicle validation searches for an occurrence through its native evaluator; node-cron validation is conversion-oriented. Chronicle task.match evaluates nextOccurrence(date - 1ms); node-cron task.match invokes its matcher directly. Lifecycle measurements intentionally include task construction, timer setup, next-run calculation, teardown, and registry cleanup. Chronicle-only fixed-after metrics are marked non-comparable and excluded from ratios.

Artifacts: `latency-log.svg` shows absolute p50/p95 values on a log scale. `latency-ratio.svg` centers the selected baseline at 1× on a symmetric log scale.
