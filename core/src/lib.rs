//! A deliberately small, deterministic cron evaluator.
//!
//! Version 0.1 supports five UTC fields: minute, hour, day-of-month, month,
//! and day-of-week. A field may be `*`, an integer, or `*/N`. Day-of-month and
//! day-of-week use AND semantics; this is an explicit contract, not a Unix cron
//! compatibility claim.

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
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

    fn matches(&self, at: DateTime<Utc>) -> bool {
        self.minute.matches(at.minute(), 0)
            && self.hour.matches(at.hour(), 0)
            && self.day_of_month.matches(at.day(), 1)
            && self.month.matches(at.month(), 1)
            && self.day_of_week.matches(at.weekday().num_days_from_sunday(), 0)
    }
}
