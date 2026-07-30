# Feature-parity matrix

This matrix prevents an ambiguous claim of “feature parity” with node-cron.
“Supported” means tested in Chronicle; “planned” is a tracked, unimplemented
capability; “out of scope” is deliberately not part of the current product.

| Capability | Chronicle v0.3 | Status |
| --- | --- | --- |
| Five-field schedules | Yes | Supported |
| Six-field seconds | Yes | Supported |
| Lists, ranges, and steps | Yes | Supported |
| Named months and weekdays | Yes | Supported |
| UTC and IANA timezone evaluation | Yes | Supported |
| Explicit fall-back policy | Yes | Chronicle-specific capability |
| In-process lifecycle, overlap guard, jitter, run limit | Yes | Supported |
| `L`, `L-n`, `W`, `LW`, `#`, weekday `L`, `?`, wrapped ranges | Yes | Differentially tested |
| Background task paths | Yes | Isolated persistent child process |
| Distributed coordination | Yes | Caller-provided coordinator, fail-closed election |
| Durable jobs and persistent retries | No | Out of scope for the in-memory engine |
| Prebuilt macOS/Linux/Windows binaries | GitHub Release assets | Automated, checksummed integration artifacts; not yet npm-installed packages |

Capabilities move to Supported only with fixtures and, where possible,
differential evidence.
