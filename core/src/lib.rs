//! Deterministic cron occurrence evaluation with explicit timezone policies.

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use std::{collections::BTreeSet, fmt};

const SEARCH_LIMIT_MINUTES: i64 = 5_260_000;

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
            Self::FieldCount { found } => write!(f, "expected five or six cron fields, found {found}"),
            Self::InvalidField { field, value } => write!(f, "invalid {field} field: {value}"),
            Self::OutOfRange { field, value, min, max } => write!(f, "{field} value {value} is outside {min}..={max}"),
            Self::NoOccurrenceWithinSearchLimit => write!(f, "no occurrence found within ten years"),
        }
    }
}
impl std::error::Error for CronError {}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Field { Any, Values(BTreeSet<u32>) }

impl Field {
    fn parse(
        name: &'static str,
        source: &str,
        min: u32,
        max: u32,
        mapper: fn(&str) -> Option<u32>,
    ) -> Result<Self, CronError> {
        if source == "*" { return Ok(Self::Any); }
        let mut values = BTreeSet::new();
        for part in source.split(',') {
            let (base, step) = match part.split_once('/') {
                Some((base, step)) => (base, Some(step.parse::<u32>().map_err(|_| CronError::InvalidField { field: name, value: part.into() })?)),
                None => (part, None),
            };
            let (start, end) = if base == "*" {
                (min, max)
            } else if let Some((start, end)) = base.split_once('-') {
                (parse_value(name, start, min, max, mapper)?, parse_value(name, end, min, max, mapper)?)
            } else {
                let value = parse_value(name, base, min, max, mapper)?;
                (value, value)
            };
            if start > end { return Err(CronError::InvalidField { field: name, value: part.into() }); }
            let step = step.unwrap_or(1);
            if step == 0 { return Err(CronError::InvalidField { field: name, value: part.into() }); }
            let mut value = start;
            while value <= end {
                values.insert(value);
                match value.checked_add(step) { Some(next) => value = next, None => break }
            }
        }
        Ok(Self::Values(values))
    }

    fn matches(&self, value: u32) -> bool {
        matches!(self, Self::Any) || matches!(self, Self::Values(values) if values.contains(&value))
    }
}

fn parse_value(name: &'static str, source: &str, min: u32, max: u32, mapper: fn(&str) -> Option<u32>) -> Result<u32, CronError> {
    let value = source.parse::<u32>().ok().or_else(|| mapper(source)).ok_or_else(|| CronError::InvalidField { field: name, value: source.into() })?;
    if !(min..=max).contains(&value) { return Err(CronError::OutOfRange { field: name, value, min, max }); }
    Ok(value)
}

fn no_names(_: &str) -> Option<u32> { None }
fn month_name(value: &str) -> Option<u32> {
    match value.to_ascii_lowercase().as_str() {
        "jan" | "january" => Some(1), "feb" | "february" => Some(2), "mar" | "march" => Some(3),
        "apr" | "april" => Some(4), "may" => Some(5), "jun" | "june" => Some(6),
        "jul" | "july" => Some(7), "aug" | "august" => Some(8), "sep" | "september" => Some(9),
        "oct" | "october" => Some(10), "nov" | "november" => Some(11), "dec" | "december" => Some(12), _ => None,
    }
}
fn weekday_name(value: &str) -> Option<u32> {
    match value.to_ascii_lowercase().as_str() {
        "sun" | "sunday" => Some(0), "mon" | "monday" => Some(1), "tue" | "tues" | "tuesday" => Some(2),
        "wed" | "wednesday" => Some(3), "thu" | "thur" | "thurs" | "thursday" => Some(4),
        "fri" | "friday" => Some(5), "sat" | "saturday" => Some(6), _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    second: Field, minute: Field, hour: Field, day_of_month: Field, month: Field, day_of_week: Field, has_seconds: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DstPolicy { WallClockOnce, WallClockTwice }

impl Schedule {
    pub fn parse(source: &str) -> Result<Self, CronError> {
        let fields: Vec<_> = source.split_whitespace().collect();
        let (has_seconds, offset) = match fields.len() { 5 => (false, 0), 6 => (true, 1), found => return Err(CronError::FieldCount { found }) };
        let day_of_week = Field::parse("day-of-week", fields[4 + offset], 0, 7, weekday_name)?;
        // Normalize cron's alternate Sunday spelling (7) to chrono's Sunday (0).
        let day_of_week = match day_of_week { Field::Values(values) => Field::Values(values.into_iter().map(|v| if v == 7 { 0 } else { v }).collect()), any => any };
        Ok(Self {
            second: if has_seconds { Field::parse("second", fields[0], 0, 59, no_names)? } else { Field::Values([0].into_iter().collect()) },
            minute: Field::parse("minute", fields[offset], 0, 59, no_names)?,
            hour: Field::parse("hour", fields[1 + offset], 0, 23, no_names)?,
            day_of_month: Field::parse("day-of-month", fields[2 + offset], 1, 31, no_names)?,
            month: Field::parse("month", fields[3 + offset], 1, 12, month_name)?,
            day_of_week,
            has_seconds,
        })
    }

    pub fn next_after(&self, after: DateTime<Utc>) -> Result<DateTime<Utc>, CronError> {
        let mut candidate = self.truncate(after.naive_utc()).and_utc() + self.increment();
        for _ in 0..self.search_limit() {
            if self.matches(candidate.naive_utc()) { return Ok(candidate); }
            candidate += self.increment();
        }
        Err(CronError::NoOccurrenceWithinSearchLimit)
    }

    pub fn next_after_in_timezone(&self, after: DateTime<Utc>, timezone: Tz, policy: DstPolicy) -> Result<DateTime<Utc>, CronError> {
        let mut candidate = self.truncate(after.with_timezone(&timezone).naive_local());
        for _ in 0..self.search_limit() {
            if self.matches(candidate) {
                let mut resolved = resolve_local(timezone, candidate, policy);
                resolved.sort_unstable();
                if let Some(next) = resolved.into_iter().find(|instant| *instant > after) { return Ok(next); }
            }
            candidate += self.increment();
        }
        Err(CronError::NoOccurrenceWithinSearchLimit)
    }

    fn matches(&self, at: NaiveDateTime) -> bool {
        self.second.matches(at.second()) && self.minute.matches(at.minute()) && self.hour.matches(at.hour())
            && self.day_of_month.matches(at.day()) && self.month.matches(at.month())
            && self.day_of_week.matches(at.weekday().num_days_from_sunday())
    }
    fn increment(&self) -> Duration { if self.has_seconds { Duration::seconds(1) } else { Duration::minutes(1) } }
    fn search_limit(&self) -> i64 { if self.has_seconds { SEARCH_LIMIT_MINUTES * 60 } else { SEARCH_LIMIT_MINUTES } }
    fn truncate(&self, value: NaiveDateTime) -> NaiveDateTime {
        if self.has_seconds { value - Duration::nanoseconds(value.nanosecond() as i64) }
        else { value - Duration::seconds(value.second() as i64) - Duration::nanoseconds(value.nanosecond() as i64) }
    }
}

fn resolve_local(timezone: Tz, local: NaiveDateTime, policy: DstPolicy) -> Vec<DateTime<Utc>> {
    match timezone.from_local_datetime(&local) {
        LocalResult::None => Vec::new(), LocalResult::Single(value) => vec![value.with_timezone(&Utc)],
        LocalResult::Ambiguous(first, second) => match policy {
            DstPolicy::WallClockOnce => vec![first.with_timezone(&Utc)], DstPolicy::WallClockTwice => vec![first.with_timezone(&Utc), second.with_timezone(&Utc)],
        },
    }
}
