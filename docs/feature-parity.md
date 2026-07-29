# Feature-parity matrix

This matrix prevents an ambiguous claim of “feature parity” with node-cron.
“Supported” means tested in Chronicle; “planned” is a tracked, unimplemented
capability; “out of scope” is deliberately not part of the current product.

| Capability | Chronicle v0.1 | Status |
| --- | --- | --- |
| Five-field schedules | Yes | Supported |
| Six-field seconds | Yes | Supported |
| Lists, ranges, and steps | Yes | Supported |
| Named months and weekdays | Yes | Supported |
| UTC and IANA timezone evaluation | Yes | Supported |
| Explicit fall-back policy | Yes | Chronicle-specific capability |
| In-process lifecycle, overlap guard, jitter, run limit | Yes | Supported |
| `L`, `W`, `#`, `?`, and nicknames | No | Planned only after a written semantic contract |
| Durable jobs, retries, worker processes, distributed coordination | No | Out of scope for the in-process engine |
| Prebuilt macOS/Linux/Windows binaries | Release assets | Automated on published GitHub Releases |

The Nool task **Close bounded node-cron feature parity gaps** owns any future
expansion of this matrix. A capability may move to Supported only with fixtures
and, where possible, differential evidence.
