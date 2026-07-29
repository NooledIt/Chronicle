//! A deliberately small, deterministic cron evaluator.
//!
//! Version 0.1 supports five UTC fields: minute, hour, day-of-month, month,
//! and day-of-week. A field may be `*`, an integer, or `*/N`. Day-of-month and
//! day-of-week use AND semantics; this is an explicit contract, not a Unix cron
//! compatibility claim.

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use std::fmt;

const SEARCH_LIMIT_MINUTES: i64 = 5_260_000; // Ten Gregorian years plus margin.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CronError {
    FieldCount { found: usize },
    InvalidField { field: &'static str, value: String },
    OutOfRange { field: &'static str, value: u32, min: u32, max: u32 },
    NoOccurrenceWithinSearchLimit,
}

impl fmt::Display for CronError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FieldCount { found } => write!(f, "expected five cron fields, found {found}"),
            Self::InvalidField { field, value } => write!(f, "invalid {field} field: {value}"),
            Self::OutOfRange { field, value, min, max } => {
                write!(f, "{field} value {value} is outside {min}..={max}")
            }
            Self::NoOccurrenceWithinSearchLimit => write!(f, "no occurrence found within ten years"),
        }
    }
}

impl std::error::Error for CronError {}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Field {
    Any,
    Exact(u32),
    Step(u32),
}

impl Field {
    fn parse(name: &'static str, source: &str, min: u32, max: u32) -> Result<Self, CronError> {
        if source == "*" {
            return Ok(Self::Any);
        }
        if let Some(step) = source.strip_prefix("*/") {
            let value = step.parse::<u32>().map_err(|_| CronError::InvalidField {
                field: name,
                value: source.to_owned(),
            })?;
            if value == 0 || value > max - min + 1 {
                return Err(CronError::InvalidField { field: name, value: source.to_owned() });
            }
            return Ok(Self::Step(value));
        }

        let value = source.parse::<u32>().map_err(|_| CronError::InvalidField {
            field: name,
            value: source.to_owned(),
        })?;
        if !(min..=max).contains(&value) {
            return Err(CronError::OutOfRange { field: name, value, min, max });
        }
        Ok(Self::Exact(value))
    }

    fn matches(&self, value: u32, min: u32) -> bool {
        match self {
            Self::Any => true,
            Self::Exact(expected) => value == *expected,
            Self::Step(step) => (value - min).is_multiple_of(*step),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    minute: Field,
    hour: Field,
    day_of_month: Field,
    month: Field,
    day_of_week: Field,
}

/// The policy used when a local wall-clock minute occurs twice at fall-back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DstPolicy {
    /// Run the first occurrence of an ambiguous local minute and skip the second.
    WallClockOnce,
    /// Treat both occurrences of an ambiguous local minute as scheduled instants.
    WallClockTwice,
}

impl Schedule {
    pub fn parse(source: &str) -> Result<Self, CronError> {
        let fields: Vec<_> = source.split_whitespace().collect();
        if fields.len() != 5 {
            return Err(CronError::FieldCount { found: fields.len() });
        }
        Ok(Self {
            minute: Field::parse("minute", fields[0], 0, 59)?,
            hour: Field::parse("hour", fields[1], 0, 23)?,
            day_of_month: Field::parse("day-of-month", fields[2], 1, 31)?,
            month: Field::parse("month", fields[3], 1, 12)?,
            day_of_week: Field::parse("day-of-week", fields[4], 0, 6)?,
        })
    }

    /// Returns the first occurrence strictly after `after` at minute precision.
    pub fn next_after(&self, after: DateTime<Utc>) -> Result<DateTime<Utc>, CronError> {
        let seconds = after.second() as i64;
        let nanos = after.nanosecond() as i64;
        let mut candidate = after - Duration::seconds(seconds) - Duration::nanoseconds(nanos) + Duration::minutes(1);
        for _ in 0..SEARCH_LIMIT_MINUTES {
            if self.matches(candidate) {
                return Ok(candidate);
            }
            candidate += Duration::minutes(1);
        }
        Err(CronError::NoOccurrenceWithinSearchLimit)
    }

    /// Returns the first occurrence strictly after `after`, interpreted in `timezone`.
    ///
    /// A nonexistent spring-forward minute is skipped. At fall-back, `policy`
    /// determines whether the repeated local minute is emitted once or twice.
    pub fn next_after_in_timezone(
        &self,
        after: DateTime<Utc>,
        timezone: Tz,
        policy: DstPolicy,
    ) -> Result<DateTime<Utc>, CronError> {
        let local = after.with_timezone(&timezone).naive_local();
        let mut candidate = truncate_to_minute(local);

        for _ in 0..SEARCH_LIMIT_MINUTES {
            if self.matches_naive(candidate) {
                let mut resolved = resolve_local_minute(timezone, candidate, policy);
                resolved.sort_unstable();
                if let Some(next) = resolved.into_iter().find(|instant| *instant > after) {
                    return Ok(next);
                }
            }
            candidate += Duration::minutes(1);
        }
        Err(CronError::NoOccurrenceWithinSearchLimit)
    }

    fn matches(&self, at: DateTime<Utc>) -> bool {
        self.matches_components(
            at.minute(),
            at.hour(),
            at.day(),
            at.month(),
            at.weekday().num_days_from_sunday(),
        )
    }

    fn matches_naive(&self, at: NaiveDateTime) -> bool {
        self.matches_components(
            at.minute(),
            at.hour(),
            at.day(),
            at.month(),
            at.weekday().num_days_from_sunday(),
        )
    }

    fn matches_components(&self, minute: u32, hour: u32, day: u32, month: u32, weekday: u32) -> bool {
        self.minute.matches(minute, 0)
            && self.hour.matches(hour, 0)
            && self.day_of_month.matches(day, 1)
            && self.month.matches(month, 1)
            && self.day_of_week.matches(weekday, 0)
    }
}

fn truncate_to_minute(value: NaiveDateTime) -> NaiveDateTime {
    value - Duration::seconds(value.second() as i64) - Duration::nanoseconds(value.nanosecond() as i64)
}

fn resolve_local_minute(timezone: Tz, local: NaiveDateTime, policy: DstPolicy) -> Vec<DateTime<Utc>> {
    match timezone.from_local_datetime(&local) {
        LocalResult::None => Vec::new(),
        LocalResult::Single(value) => vec![value.with_timezone(&Utc)],
        LocalResult::Ambiguous(first, second) => match policy {
            DstPolicy::WallClockOnce => vec![first.with_timezone(&Utc)],
            DstPolicy::WallClockTwice => vec![first.with_timezone(&Utc), second.with_timezone(&Utc)],
        },
    }
}
