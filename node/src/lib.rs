use chrono::{DateTime, SecondsFormat, Utc};
use chrono_tz::Tz;
use chronicle_core::{DstPolicy, Schedule};
use napi::{Error, Result, Status};
use napi_derive::napi;

#[napi(object)]
pub struct NextOccurrenceOptions {
    /// An IANA timezone such as `America/New_York`. Omit for UTC evaluation.
    pub timezone: Option<String>,
    /// `wallClockOnce` (default) or `wallClockTwice`.
    pub dst_policy: Option<String>,
}

#[napi]
pub fn next_occurrence(
    expression: String,
    after: String,
    options: Option<NextOccurrenceOptions>,
) -> Result<String> {
    let schedule = Schedule::parse(&expression).map_err(invalid_argument)?;
    let after = DateTime::parse_from_rfc3339(&after)
        .map_err(|error| Error::new(Status::InvalidArg, format!("invalid RFC 3339 timestamp: {error}")))?
        .with_timezone(&Utc);

    let next = match options {
        None => schedule.next_after(after).map_err(invalid_argument)?,
        Some(options) => match options.timezone {
            None => schedule.next_after(after).map_err(invalid_argument)?,
            Some(timezone) => {
                let timezone = timezone.parse::<Tz>().map_err(|_| {
                    Error::new(Status::InvalidArg, format!("unknown IANA timezone: {timezone}"))
                })?;
                schedule
                    .next_after_in_timezone(after, timezone, parse_policy(options.dst_policy)?)
                    .map_err(invalid_argument)?
            }
        },
    };

    Ok(next.to_rfc3339_opts(SecondsFormat::Secs, true))
}

fn parse_policy(value: Option<String>) -> Result<DstPolicy> {
    match value.as_deref().unwrap_or("wallClockOnce") {
        "wallClockOnce" => Ok(DstPolicy::WallClockOnce),
        "wallClockTwice" => Ok(DstPolicy::WallClockTwice),
        other => Err(Error::new(
            Status::InvalidArg,
            format!("invalid dstPolicy: {other}; expected wallClockOnce or wallClockTwice"),
        )),
    }
}

fn invalid_argument(error: chronicle_core::CronError) -> Error {
    Error::new(Status::InvalidArg, error.to_string())
}
