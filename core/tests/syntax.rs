use chrono::{DateTime, Utc};
use chronicle_core::Schedule;

fn utc(value: &str) -> DateTime<Utc> { value.parse().unwrap() }

#[test]
fn six_field_schedules_evaluate_at_second_precision() {
    let schedule = Schedule::parse("*/30 * * * * *").unwrap();
    assert_eq!(schedule.next_after(utc("2026-01-01T00:00:01Z")).unwrap(), utc("2026-01-01T00:00:30Z"));
}

#[test]
fn lists_ranges_steps_and_names_can_be_combined() {
    let schedule = Schedule::parse("0 9-17/2 * Jan,Sep Mon-Fri").unwrap();
    assert_eq!(schedule.next_after(utc("2026-01-05T08:59:00Z")).unwrap(), utc("2026-01-05T09:00:00Z"));
    assert_eq!(schedule.next_after(utc("2026-01-05T17:00:00Z")).unwrap(), utc("2026-01-06T09:00:00Z"));
}

#[test]
fn sunday_accepts_both_zero_and_seven() {
    let zero = Schedule::parse("0 0 * * 0").unwrap();
    let seven = Schedule::parse("0 0 * * 7").unwrap();
    let after = utc("2026-01-03T23:59:00Z");
    assert_eq!(zero.next_after(after).unwrap(), seven.next_after(after).unwrap());
}

#[test]
fn invalid_ranges_and_names_are_rejected() {
    for expression in ["10-1 * * * *", "0 0 * Foo *", "0 0 * * Funday", "*/0 * * * *"] {
        assert!(Schedule::parse(expression).is_err(), "{expression}");
    }
}
