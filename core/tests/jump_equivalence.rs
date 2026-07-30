use chronicle_core::Schedule;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};

#[derive(Debug)]
struct Oracle {
    second: Vec<bool>,
    minute: Vec<bool>,
    hour: Vec<bool>,
    day: Vec<bool>,
    month: Vec<bool>,
    weekday: Vec<bool>,
    has_seconds: bool,
}

impl Oracle {
    fn parse(expression: &str) -> Self {
        let raw: Vec<_> = expression.split_whitespace().collect();
        assert!(
            matches!(raw.len(), 5 | 6),
            "oracle subset field count: {expression}"
        );
        let (has_seconds, fields) = if raw.len() == 6 {
            (true, raw)
        } else {
            (false, [&["0"][..], &raw[..]].concat())
        };
        Self {
            second: parse_field(fields[0], 0, 59, no_name, false),
            minute: parse_field(fields[1], 0, 59, no_name, false),
            hour: parse_field(fields[2], 0, 23, no_name, false),
            day: parse_field(fields[3], 1, 31, no_name, false),
            month: parse_field(fields[4], 1, 12, month_name, false),
            weekday: parse_field(fields[5], 0, 7, weekday_name, true),
            has_seconds,
        }
    }

    fn matches(&self, at: DateTime<Utc>) -> bool {
        self.second[at.second() as usize]
            && self.minute[at.minute() as usize]
            && self.hour[at.hour() as usize]
            && self.day[at.day() as usize]
            && self.month[at.month() as usize]
            && self.weekday[at.weekday().num_days_from_sunday() as usize]
    }

    fn next_after(&self, after: DateTime<Utc>, limit: usize) -> DateTime<Utc> {
        let increment = if self.has_seconds {
            Duration::seconds(1)
        } else {
            Duration::minutes(1)
        };
        let mut candidate = if self.has_seconds {
            after.with_nanosecond(0).unwrap() + increment
        } else {
            after.with_second(0).unwrap().with_nanosecond(0).unwrap() + increment
        };
        for _ in 0..limit {
            if self.matches(candidate) {
                return candidate;
            }
            candidate += increment;
        }
        panic!("oracle exhausted its bounded search after {after}");
    }
}

fn parse_field(
    source: &str,
    min: u32,
    max: u32,
    names: fn(&str) -> Option<u32>,
    normalize_sunday: bool,
) -> Vec<bool> {
    let output_max = if normalize_sunday { 6 } else { max };
    let mut result = vec![false; output_max as usize + 1];
    for item in source.split(',') {
        let mut divided = item.split('/');
        let base = divided.next().unwrap();
        let step = divided
            .next()
            .map(|value| value.parse::<u32>().unwrap())
            .unwrap_or(1);
        assert!(
            divided.next().is_none() && step > 0,
            "oracle subset field: {source}"
        );
        let (start, end) = if matches!(base, "*" | "?") {
            (min, max)
        } else if let Some((left, right)) = base.split_once('-') {
            (value(left, names), value(right, names))
        } else {
            let literal = value(base, names);
            (literal, literal)
        };
        assert!((min..=max).contains(&start) && (min..=max).contains(&end));
        let width = max - min + 1;
        let span = if start <= end {
            end - start
        } else {
            max - start + 1 + end - min
        };
        let mut offset = 0;
        while offset <= span {
            let raw = min + ((start - min + offset) % width);
            let normalized = if normalize_sunday && raw == 7 { 0 } else { raw };
            result[normalized as usize] = true;
            offset += step;
        }
    }
    result
}

fn value(source: &str, names: fn(&str) -> Option<u32>) -> u32 {
    source.parse().ok().or_else(|| names(source)).unwrap()
}

fn no_name(_: &str) -> Option<u32> {
    None
}

fn month_name(source: &str) -> Option<u32> {
    match source.to_ascii_lowercase().as_str() {
        "jan" => Some(1),
        "feb" => Some(2),
        "mar" => Some(3),
        "apr" => Some(4),
        "may" => Some(5),
        "jun" => Some(6),
        "jul" => Some(7),
        "aug" => Some(8),
        "sep" => Some(9),
        "oct" => Some(10),
        "nov" => Some(11),
        "dec" => Some(12),
        _ => None,
    }
}

fn weekday_name(source: &str) -> Option<u32> {
    match source.to_ascii_lowercase().as_str() {
        "sun" => Some(0),
        "mon" => Some(1),
        "tue" => Some(2),
        "wed" => Some(3),
        "thu" => Some(4),
        "fri" => Some(5),
        "sat" => Some(6),
        _ => None,
    }
}

fn utc(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

fn assert_oracle(expression: &str, after: DateTime<Utc>, limit: usize) {
    let expected = Oracle::parse(expression).next_after(after, limit);
    let actual = Schedule::parse(expression)
        .unwrap()
        .next_after(after)
        .unwrap();
    assert_eq!(actual, expected, "expression={expression}, after={after}");
}

#[test]
fn deterministic_randomized_standard_schedules_match_brute_force() {
    const SECOND_EXPRESSIONS: &[&str] = &[
        "* * * * * *",
        "*/7 * * * * *",
        "5,17,43 * * * * *",
        "50-10/10 * * * * *",
        "11 */3 * * * *",
    ];
    const MINUTE_EXPRESSIONS: &[&str] = &[
        "* * * * *",
        "*/11 * * * *",
        "3,19,47 * * * *",
        "50-10/10 * * * *",
        "7 */3 * * *",
        "0 22-2 * * *",
    ];

    // A tiny fixed LCG makes failures reproducible without sharing any parser or matcher code.
    let mut state = 0x9e37_79b9_7f4a_7c15_u64;
    for case in 0..192 {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1);
        let day_offset = ((state >> 16) % 330) as i64;
        let second_offset = ((state >> 40) % 86_400) as i64;
        let nanos = ((state >> 8) % 900_000_000) as u32;
        let after = (Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
            + Duration::days(day_offset)
            + Duration::seconds(second_offset))
        .with_nanosecond(nanos)
        .unwrap();
        if case % 2 == 0 {
            let expression = SECOND_EXPRESSIONS[(state as usize) % SECOND_EXPRESSIONS.len()];
            assert_oracle(expression, after, 22_000);
        } else {
            let expression = MINUTE_EXPRESSIONS[(state as usize) % MINUTE_EXPRESSIONS.len()];
            assert_oracle(expression, after, 5_000);
        }
    }
}

#[test]
fn named_calendar_ranges_match_an_independent_minute_oracle() {
    for (expression, after, limit) in [
        ("0 9-17/2 * Jan,Sep Mon-Fri", "2026-08-29T12:34:56Z", 20_000),
        ("15 6 * Mar-Jun Tue-Thu", "2026-02-27T23:59:59Z", 100_000),
        ("0 0 1 Nov-Feb ?", "2026-10-15T00:00:00Z", 30_000),
        ("0 0 ? * Fri-Mon", "2026-01-05T00:00:00Z", 10_000),
    ] {
        assert_oracle(expression, utc(after), limit);
    }
}

#[test]
fn sparse_yearly_leap_and_advanced_rules_have_exact_occurrences() {
    for (expression, after, expected) in [
        (
            "0 0 29 Feb ?",
            "2024-02-29T00:00:00Z",
            "2028-02-29T00:00:00Z",
        ),
        (
            "0 0 31 Dec ?",
            "2026-12-31T00:00:00Z",
            "2027-12-31T00:00:00Z",
        ),
        (
            "0 0 L Feb ?",
            "2028-02-27T00:00:00Z",
            "2028-02-29T00:00:00Z",
        ),
        (
            "0 0 L-1 Feb ?",
            "2028-02-27T00:00:00Z",
            "2028-02-28T00:00:00Z",
        ),
        (
            "0 0 1W Aug ?",
            "2026-07-31T23:59:00Z",
            "2026-08-03T00:00:00Z",
        ),
        (
            "0 0 LW Jan ?",
            "2026-01-01T00:00:00Z",
            "2026-01-30T00:00:00Z",
        ),
        (
            "0 0 ? Mar MON#5",
            "2027-03-01T00:00:00Z",
            "2027-03-29T00:00:00Z",
        ),
        (
            "0 0 ? Feb SUNL",
            "2026-02-01T00:00:00Z",
            "2026-02-22T00:00:00Z",
        ),
        (
            "0 0 1 Nov-Feb ?",
            "2026-02-01T00:00:00Z",
            "2026-11-01T00:00:00Z",
        ),
    ] {
        let actual = Schedule::parse(expression)
            .unwrap()
            .next_after(utc(after))
            .unwrap();
        assert_eq!(
            actual,
            utc(expected),
            "expression={expression}, after={after}"
        );
    }
}
