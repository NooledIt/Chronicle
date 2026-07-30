//! Deterministic cron occurrence evaluation with explicit timezone policies.

use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc,
};
use chrono_tz::Tz;
use std::{collections::BTreeSet, fmt};

const SEARCH_LIMIT_MINUTES: i64 = 5_260_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CronError {
    FieldCount {
        found: usize,
    },
    InvalidField {
        field: &'static str,
        value: String,
    },
    OutOfRange {
        field: &'static str,
        value: u32,
        min: u32,
        max: u32,
    },
    NoOccurrenceWithinSearchLimit,
}

impl fmt::Display for CronError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FieldCount { found } => {
                write!(f, "expected five or six cron fields, found {found}")
            }
            Self::InvalidField { field, value } => write!(f, "invalid {field} field: {value}"),
            Self::OutOfRange {
                field,
                value,
                min,
                max,
            } => write!(f, "{field} value {value} is outside {min}..={max}"),
            Self::NoOccurrenceWithinSearchLimit => {
                write!(f, "no occurrence found within ten years")
            }
        }
    }
}
impl std::error::Error for CronError {}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Field {
    Any,
    Values(BTreeSet<u32>),
}

impl Field {
    fn parse(
        name: &'static str,
        source: &str,
        min: u32,
        max: u32,
        mapper: fn(&str) -> Option<u32>,
    ) -> Result<Self, CronError> {
        if source == "*" {
            return Ok(Self::Any);
        }
        let mut values = BTreeSet::new();
        for part in source.split(',') {
            let (base, step) = match part.split_once('/') {
                Some((base, step)) => (
                    base,
                    Some(step.parse::<u32>().map_err(|_| CronError::InvalidField {
                        field: name,
                        value: part.into(),
                    })?),
                ),
                None => (part, None),
            };
            let (start, end) = if base == "*" {
                (min, max)
            } else if let Some((start, end)) = base.split_once('-') {
                (
                    parse_value(name, start, min, max, mapper)?,
                    parse_value(name, end, min, max, mapper)?,
                )
            } else {
                let value = parse_value(name, base, min, max, mapper)?;
                (value, value)
            };
            let step = step.unwrap_or(1);
            if step == 0 {
                return Err(CronError::InvalidField {
                    field: name,
                    value: part.into(),
                });
            }
            let span = if start <= end {
                end - start
            } else {
                max - start + 1 + end - min
            };
            let mut offset = 0;
            while offset <= span {
                let value = min + ((start - min + offset) % (max - min + 1));
                values.insert(value);
                match offset.checked_add(step) {
                    Some(next) => offset = next,
                    None => break,
                }
            }
        }
        Ok(Self::Values(values))
    }

    fn matches(&self, value: u32) -> bool {
        matches!(self, Self::Any) || matches!(self, Self::Values(values) if values.contains(&value))
    }

    fn next_at_or_after(&self, value: u32) -> Option<u32> {
        match self {
            Self::Any => Some(value),
            Self::Values(values) => values.range(value..).next().copied(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DayOfMonthRule {
    Values(Field),
    Last { offset: u32 },
    NearestWeekday { day: u32 },
    LastWeekday,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DayOfMonth(Vec<DayOfMonthRule>);

impl DayOfMonth {
    fn parse(source: &str) -> Result<Self, CronError> {
        if source == "*" || source == "?" {
            return Ok(Self(vec![DayOfMonthRule::Values(Field::Any)]));
        }
        let mut rules = Vec::new();
        let mut ordinary = Vec::new();
        for part in source.split(',') {
            let upper = part.to_ascii_uppercase();
            if upper == "L" {
                rules.push(DayOfMonthRule::Last { offset: 0 });
            } else if upper == "LW" {
                rules.push(DayOfMonthRule::LastWeekday);
            } else if let Some(offset) = upper.strip_prefix("L-") {
                let offset = offset
                    .parse::<u32>()
                    .map_err(|_| invalid("day-of-month", part))?;
                if !(1..=30).contains(&offset) {
                    return Err(invalid("day-of-month", part));
                }
                rules.push(DayOfMonthRule::Last { offset });
            } else if let Some(day) = upper.strip_suffix('W') {
                let day = parse_value("day-of-month", day, 1, 31, no_names)?;
                rules.push(DayOfMonthRule::NearestWeekday { day });
            } else if part.contains('?') || upper.contains('L') || upper.contains('W') {
                return Err(invalid("day-of-month", part));
            } else {
                ordinary.push(part);
            }
        }
        if !ordinary.is_empty() {
            rules.push(DayOfMonthRule::Values(Field::parse(
                "day-of-month",
                &ordinary.join(","),
                1,
                31,
                no_names,
            )?));
        }
        if rules.is_empty() {
            return Err(invalid("day-of-month", source));
        }
        Ok(Self(rules))
    }

    fn matches(&self, at: NaiveDateTime) -> bool {
        let last = last_day_of_month(at.year(), at.month());
        self.0.iter().any(|rule| match rule {
            DayOfMonthRule::Values(field) => field.matches(at.day()),
            DayOfMonthRule::Last { offset } => last.checked_sub(*offset) == Some(at.day()),
            DayOfMonthRule::NearestWeekday { day } => {
                *day <= last && nearest_weekday(at.year(), at.month(), *day) == at.day()
            }
            DayOfMonthRule::LastWeekday => nearest_weekday(at.year(), at.month(), last) == at.day(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DayOfWeekRule {
    Values(Field),
    Nth { weekday: u32, occurrence: u32 },
    Last { weekday: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DayOfWeek(Vec<DayOfWeekRule>);

impl DayOfWeek {
    fn parse(source: &str) -> Result<Self, CronError> {
        if source == "*" || source == "?" {
            return Ok(Self(vec![DayOfWeekRule::Values(Field::Any)]));
        }
        let mut rules = Vec::new();
        let mut ordinary = Vec::new();
        for part in source.split(',') {
            let upper = part.to_ascii_uppercase();
            if let Some((weekday, occurrence)) = upper.split_once('#') {
                let weekday =
                    normalize_weekday(parse_value("day-of-week", weekday, 0, 7, weekday_name)?);
                let occurrence = occurrence
                    .parse::<u32>()
                    .map_err(|_| invalid("day-of-week", part))?;
                if !(1..=5).contains(&occurrence) {
                    return Err(invalid("day-of-week", part));
                }
                rules.push(DayOfWeekRule::Nth {
                    weekday,
                    occurrence,
                });
            } else if let Some(weekday) = upper.strip_suffix('L') {
                if weekday.is_empty() {
                    return Err(invalid("day-of-week", part));
                }
                let weekday =
                    normalize_weekday(parse_value("day-of-week", weekday, 0, 7, weekday_name)?);
                rules.push(DayOfWeekRule::Last { weekday });
            } else if part.contains('?') || upper.contains('L') || upper.contains('#') {
                return Err(invalid("day-of-week", part));
            } else {
                ordinary.push(part);
            }
        }
        if !ordinary.is_empty() {
            let field = Field::parse("day-of-week", &ordinary.join(","), 0, 7, weekday_name)?;
            let field = match field {
                Field::Values(values) => {
                    Field::Values(values.into_iter().map(normalize_weekday).collect())
                }
                any => any,
            };
            rules.push(DayOfWeekRule::Values(field));
        }
        if rules.is_empty() {
            return Err(invalid("day-of-week", source));
        }
        Ok(Self(rules))
    }

    fn matches(&self, at: NaiveDateTime) -> bool {
        let weekday = at.weekday().num_days_from_sunday();
        let last = last_day_of_month(at.year(), at.month());
        self.0.iter().any(|rule| match rule {
            DayOfWeekRule::Values(field) => field.matches(weekday),
            DayOfWeekRule::Nth {
                weekday: expected,
                occurrence,
            } => weekday == *expected && ((at.day() - 1) / 7) + 1 == *occurrence,
            DayOfWeekRule::Last { weekday: expected } => {
                weekday == *expected && at.day() + 7 > last
            }
        })
    }
}

fn invalid(field: &'static str, value: &str) -> CronError {
    CronError::InvalidField {
        field,
        value: value.into(),
    }
}

fn normalize_weekday(value: u32) -> u32 {
    if value == 7 { 0 } else { value }
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    (NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid next month")
        - Duration::days(1))
    .day()
}

fn nearest_weekday(year: i32, month: u32, day: u32) -> u32 {
    let last = last_day_of_month(year, month);
    let date = NaiveDate::from_ymd_opt(year, month, day).expect("validated day in month");
    match date.weekday().num_days_from_sunday() {
        6 if day == 1 => 3,
        6 => day - 1,
        0 if day == last => day - 2,
        0 => day + 1,
        _ => day,
    }
}

fn parse_value(
    name: &'static str,
    source: &str,
    min: u32,
    max: u32,
    mapper: fn(&str) -> Option<u32>,
) -> Result<u32, CronError> {
    let value = source
        .parse::<u32>()
        .ok()
        .or_else(|| mapper(source))
        .ok_or_else(|| CronError::InvalidField {
            field: name,
            value: source.into(),
        })?;
    if !(min..=max).contains(&value) {
        return Err(CronError::OutOfRange {
            field: name,
            value,
            min,
            max,
        });
    }
    Ok(value)
}

fn no_names(_: &str) -> Option<u32> {
    None
}
fn month_name(value: &str) -> Option<u32> {
    match value.to_ascii_lowercase().as_str() {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" => Some(4),
        "may" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "september" => Some(9),
        "oct" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "december" => Some(12),
        _ => None,
    }
}
fn weekday_name(value: &str) -> Option<u32> {
    match value.to_ascii_lowercase().as_str() {
        "sun" | "sunday" => Some(0),
        "mon" | "monday" => Some(1),
        "tue" | "tues" | "tuesday" => Some(2),
        "wed" | "wednesday" => Some(3),
        "thu" | "thur" | "thurs" | "thursday" => Some(4),
        "fri" | "friday" => Some(5),
        "sat" | "saturday" => Some(6),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    second: Field,
    minute: Field,
    hour: Field,
    day_of_month: DayOfMonth,
    month: Field,
    day_of_week: DayOfWeek,
    has_seconds: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DstPolicy {
    WallClockOnce,
    WallClockTwice,
}

impl Schedule {
    pub fn parse(source: &str) -> Result<Self, CronError> {
        let fields: Vec<_> = source.split_whitespace().collect();
        let (has_seconds, offset) = match fields.len() {
            5 => (false, 0),
            6 => (true, 1),
            found => return Err(CronError::FieldCount { found }),
        };
        Ok(Self {
            second: if has_seconds {
                Field::parse("second", fields[0], 0, 59, no_names)?
            } else {
                Field::Values([0].into_iter().collect())
            },
            minute: Field::parse("minute", fields[offset], 0, 59, no_names)?,
            hour: Field::parse("hour", fields[1 + offset], 0, 23, no_names)?,
            day_of_month: DayOfMonth::parse(fields[2 + offset])?,
            month: Field::parse("month", fields[3 + offset], 1, 12, month_name)?,
            day_of_week: DayOfWeek::parse(fields[4 + offset])?,
            has_seconds,
        })
    }

    pub fn next_after(&self, after: DateTime<Utc>) -> Result<DateTime<Utc>, CronError> {
        let start = self.truncate(after.naive_utc()) + self.increment();
        let deadline = start
            .checked_add_signed(Duration::minutes(SEARCH_LIMIT_MINUTES))
            .ok_or(CronError::NoOccurrenceWithinSearchLimit)?;
        self.next_matching_at_or_after(start, deadline)
            .map(|candidate| candidate.and_utc())
            .ok_or(CronError::NoOccurrenceWithinSearchLimit)
    }

    pub fn next_after_in_timezone(
        &self,
        after: DateTime<Utc>,
        timezone: Tz,
        policy: DstPolicy,
    ) -> Result<DateTime<Utc>, CronError> {
        let mut cursor = self.truncate(after.with_timezone(&timezone).naive_local());
        let deadline = cursor
            .checked_add_signed(Duration::minutes(SEARCH_LIMIT_MINUTES))
            .ok_or(CronError::NoOccurrenceWithinSearchLimit)?;
        if policy == DstPolicy::WallClockTwice && is_ambiguous(timezone, cursor) {
            let (start, end) = ambiguity_window(timezone, cursor, self.increment())?;
            let window_deadline = end
                .checked_sub_signed(self.increment())
                .ok_or(CronError::NoOccurrenceWithinSearchLimit)?;
            let mut scan = start;
            let mut earliest = None;
            while let Some(candidate) = self.next_matching_at_or_after(scan, window_deadline) {
                for instant in resolve_local(timezone, candidate, policy) {
                    if instant > after && earliest.is_none_or(|current| instant < current) {
                        earliest = Some(instant);
                    }
                }
                scan = candidate
                    .checked_add_signed(self.increment())
                    .ok_or(CronError::NoOccurrenceWithinSearchLimit)?;
            }
            if let Some(next) = earliest {
                return Ok(next);
            }
            cursor = end;
        }
        while let Some(candidate) = self.next_matching_at_or_after(cursor, deadline) {
            let mut resolved = resolve_local(timezone, candidate, policy);
            resolved.sort_unstable();
            if let Some(next) = resolved.into_iter().find(|instant| *instant > after) {
                return Ok(next);
            }
            cursor = candidate
                .checked_add_signed(self.increment())
                .ok_or(CronError::NoOccurrenceWithinSearchLimit)?;
        }
        Err(CronError::NoOccurrenceWithinSearchLimit)
    }

    fn next_matching_at_or_after(
        &self,
        mut candidate: NaiveDateTime,
        deadline: NaiveDateTime,
    ) -> Option<NaiveDateTime> {
        while candidate <= deadline {
            if !self.month.matches(candidate.month()) {
                candidate = self.next_month_start(candidate)?;
                continue;
            }
            if !self.day_of_month.matches(candidate) || !self.day_of_week.matches(candidate) {
                candidate = candidate.date().succ_opt()?.and_hms_opt(0, 0, 0)?;
                continue;
            }
            if !self.hour.matches(candidate.hour()) {
                candidate = match self.hour.next_at_or_after(candidate.hour()) {
                    Some(hour) => candidate.date().and_hms_opt(hour, 0, 0)?,
                    None => candidate.date().succ_opt()?.and_hms_opt(0, 0, 0)?,
                };
                continue;
            }
            if !self.minute.matches(candidate.minute()) {
                candidate = match self.minute.next_at_or_after(candidate.minute()) {
                    Some(minute) => candidate.date().and_hms_opt(candidate.hour(), minute, 0)?,
                    None => candidate
                        .date()
                        .and_hms_opt(candidate.hour(), 0, 0)?
                        .checked_add_signed(Duration::hours(1))?,
                };
                continue;
            }
            if !self.second.matches(candidate.second()) {
                candidate = match self.second.next_at_or_after(candidate.second()) {
                    Some(second) => candidate.date().and_hms_opt(
                        candidate.hour(),
                        candidate.minute(),
                        second,
                    )?,
                    None => candidate
                        .date()
                        .and_hms_opt(candidate.hour(), candidate.minute(), 0)?
                        .checked_add_signed(Duration::minutes(1))?,
                };
                continue;
            }
            debug_assert!(self.matches(candidate));
            return Some(candidate);
        }
        None
    }

    fn next_month_start(&self, candidate: NaiveDateTime) -> Option<NaiveDateTime> {
        let mut year = candidate.year();
        let mut month = candidate.month();
        for _ in 0..12 {
            if month == 12 {
                year = year.checked_add(1)?;
                month = 1;
            } else {
                month += 1;
            }
            if self.month.matches(month) {
                return NaiveDate::from_ymd_opt(year, month, 1)?.and_hms_opt(0, 0, 0);
            }
        }
        None
    }

    fn matches(&self, at: NaiveDateTime) -> bool {
        self.second.matches(at.second())
            && self.minute.matches(at.minute())
            && self.hour.matches(at.hour())
            && self.day_of_month.matches(at)
            && self.month.matches(at.month())
            && self.day_of_week.matches(at)
    }
    fn increment(&self) -> Duration {
        if self.has_seconds {
            Duration::seconds(1)
        } else {
            Duration::minutes(1)
        }
    }
    fn truncate(&self, value: NaiveDateTime) -> NaiveDateTime {
        if self.has_seconds {
            value - Duration::nanoseconds(value.nanosecond() as i64)
        } else {
            value
                - Duration::seconds(value.second() as i64)
                - Duration::nanoseconds(value.nanosecond() as i64)
        }
    }
}

fn is_ambiguous(timezone: Tz, local: NaiveDateTime) -> bool {
    matches!(
        timezone.from_local_datetime(&local),
        LocalResult::Ambiguous(_, _)
    )
}

fn ambiguity_window(
    timezone: Tz,
    local: NaiveDateTime,
    increment: Duration,
) -> Result<(NaiveDateTime, NaiveDateTime), CronError> {
    let mut start = local;
    while let Some(previous) = start.checked_sub_signed(increment) {
        if !is_ambiguous(timezone, previous) {
            break;
        }
        start = previous;
    }
    let mut end = local;
    while is_ambiguous(timezone, end) {
        end = end
            .checked_add_signed(increment)
            .ok_or(CronError::NoOccurrenceWithinSearchLimit)?;
    }
    Ok((start, end))
}

fn resolve_local(timezone: Tz, local: NaiveDateTime, policy: DstPolicy) -> Vec<DateTime<Utc>> {
    match timezone.from_local_datetime(&local) {
        LocalResult::None => Vec::new(),
        LocalResult::Single(value) => vec![value.with_timezone(&Utc)],
        LocalResult::Ambiguous(first, second) => match policy {
            DstPolicy::WallClockOnce => vec![first.with_timezone(&Utc)],
            DstPolicy::WallClockTwice => {
                vec![first.with_timezone(&Utc), second.with_timezone(&Utc)]
            }
        },
    }
}
