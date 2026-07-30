# Chronicle v0.1 contract

Chronicle evaluates five- or six-field cron expressions in UTC and returns the
first matching instant strictly after an input instant.

## Supported grammar

`[second] minute hour day-of-month month day-of-week`

Each field accepts `*`, numeric literals, comma lists, inclusive ranges, and
wildcard or range steps. Months and weekdays also accept three-letter and full
English names. Field ranges are second/minute `0-59`, hour `0-23`,
day-of-month `1-31`, month `1-12`, and day-of-week `0-7`, where both `0` and
`7` mean Sunday. Five-field input implies second `0`.

Ranges may wrap through their boundary (`22-2`, `Fri-Mon`). Day-of-month also
accepts `L`, `L-n`, `nW`, and `LW`; day-of-week accepts `weekday#n` and
`weekdayL`. `?` aliases `*` in either day field.

## Deterministic semantics

All supplied fields must match. In particular, day-of-month and day-of-week are
combined with **AND**, unlike some Unix cron implementations. Invalid calendar
dates simply do not occur. Inputs and outputs are UTC instants.

## Explicit non-goals for v0

This release excludes job persistence and durable retries. Node background
paths and coordinator-backed distributed execution are execution-layer
features and do not change occurrence evaluation.

## Local time and DST

`next_after_in_timezone` evaluates the same grammar in an IANA timezone. A
nonexistent local minute during spring-forward is skipped. A repeated minute
during fall-back is controlled explicitly: `WallClockOnce` emits the earlier
instant only, while `WallClockTwice` emits both instants. The UTC API remains
the simpler, timezone-free reference behavior.
