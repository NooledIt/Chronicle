# Chronicle v0 contract

Chronicle evaluates five-field cron expressions in UTC and returns the first
matching minute strictly after an input instant.

## Supported grammar

`minute hour day-of-month month day-of-week`

Each field accepts `*`, one integer, or `*/N`. Field ranges are minute `0-59`,
hour `0-23`, day-of-month `1-31`, month `1-12`, and day-of-week `0-6` where
Sunday is `0`.

## Deterministic semantics

All five fields must match. In particular, day-of-month and day-of-week are
combined with **AND**, unlike some Unix cron implementations. Invalid calendar
dates simply do not occur. Inputs and outputs are UTC instants.

## Explicit non-goals for v0

This release does not yet implement named fields, ranges, lists, or six-field
seconds. Those features will be added only with an independently specified
fixture corpus.

## Local time and DST

`next_after_in_timezone` evaluates the same grammar in an IANA timezone. A
nonexistent local minute during spring-forward is skipped. A repeated minute
during fall-back is controlled explicitly: `WallClockOnce` emits the earlier
instant only, while `WallClockTwice` emits both instants. The UTC API remains
the simpler, timezone-free reference behavior.
