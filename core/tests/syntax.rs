use chronicle_core::Schedule;
use chrono::{DateTime, Utc};

fn utc(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

#[test]
fn six_field_schedules_evaluate_at_second_precision() {
    let schedule = Schedule::parse("*/30 * * * * *").unwrap();
    assert_eq!(
        schedule.next_after(utc("2026-01-01T00:00:01Z")).unwrap(),
        utc("2026-01-01T00:00:30Z")
    );
}

#[test]
fn lists_ranges_steps_and_names_can_be_combined() {
    let schedule = Schedule::parse("0 9-17/2 * Jan,Sep Mon-Fri").unwrap();
    assert_eq!(
        schedule.next_after(utc("2026-01-05T08:59:00Z")).unwrap(),
        utc("2026-01-05T09:00:00Z")
    );
    assert_eq!(
        schedule.next_after(utc("2026-01-05T17:00:00Z")).unwrap(),
        utc("2026-01-06T09:00:00Z")
    );
}

#[test]
fn sunday_accepts_both_zero_and_seven() {
    let zero = Schedule::parse("0 0 * * 0").unwrap();
    let seven = Schedule::parse("0 0 * * 7").unwrap();
    let after = utc("2026-01-03T23:59:00Z");
    assert_eq!(
        zero.next_after(after).unwrap(),
        seven.next_after(after).unwrap()
    );
}

#[test]
fn invalid_special_forms_and_names_are_rejected() {
    for expression in [
        "0 0 L-31 * ?",
        "0 0 L-0 * ?",
        "0 0 32W * ?",
        "0 0 ? * MON#0",
        "0 0 ? * MON#6",
        "0 0 ? * L",
        "0 0 * Foo *",
        "0 0 * * Funday",
        "*/0 * * * *",
    ] {
        assert!(Schedule::parse(expression).is_err(), "{expression}");
    }
}

#[test]
fn last_day_offsets_and_last_weekday_use_the_actual_month() {
    let after = utc("2026-02-26T23:59:00Z");
    assert_eq!(
        Schedule::parse("0 0 L * ?")
            .unwrap()
            .next_after(after)
            .unwrap(),
        utc("2026-02-28T00:00:00Z")
    );
    assert_eq!(
        Schedule::parse("0 0 L-1 * ?")
            .unwrap()
            .next_after(after)
            .unwrap(),
        utc("2026-02-27T00:00:00Z")
    );
    assert_eq!(
        Schedule::parse("0 0 LW * ?")
            .unwrap()
            .next_after(utc("2026-05-28T00:00:00Z"))
            .unwrap(),
        utc("2026-05-29T00:00:00Z")
    );
}

#[test]
fn nearest_weekday_stays_inside_the_month() {
    assert_eq!(
        Schedule::parse("0 0 1W * ?")
            .unwrap()
            .next_after(utc("2026-07-31T00:00:00Z"))
            .unwrap(),
        utc("2026-08-03T00:00:00Z")
    );
    assert_eq!(
        Schedule::parse("0 0 31W * ?")
            .unwrap()
            .next_after(utc("2026-05-28T00:00:00Z"))
            .unwrap(),
        utc("2026-05-29T00:00:00Z")
    );
}

#[test]
fn nth_and_last_weekday_rules_match_calendar_positions() {
    assert_eq!(
        Schedule::parse("0 0 ? * MON#2")
            .unwrap()
            .next_after(utc("2026-01-01T00:00:00Z"))
            .unwrap(),
        utc("2026-01-12T00:00:00Z")
    );
    assert_eq!(
        Schedule::parse("0 0 ? * 5L")
            .unwrap()
            .next_after(utc("2026-01-01T00:00:00Z"))
            .unwrap(),
        utc("2026-01-30T00:00:00Z")
    );
}

#[test]
fn inverted_ranges_wrap_through_field_boundaries() {
    assert_eq!(
        Schedule::parse("50-10/10 * * * *")
            .unwrap()
            .next_after(utc("2026-01-01T00:50:00Z"))
            .unwrap(),
        utc("2026-01-01T01:00:00Z")
    );
    assert_eq!(
        Schedule::parse("0 22-2 * * *")
            .unwrap()
            .next_after(utc("2026-01-01T23:00:00Z"))
            .unwrap(),
        utc("2026-01-02T00:00:00Z")
    );
    assert_eq!(
        Schedule::parse("0 0 1 Nov-Feb ?")
            .unwrap()
            .next_after(utc("2026-12-01T00:00:00Z"))
            .unwrap(),
        utc("2027-01-01T00:00:00Z")
    );
    assert_eq!(
        Schedule::parse("0 0 ? * Fri-Mon")
            .unwrap()
            .next_after(utc("2026-01-02T00:00:00Z"))
            .unwrap(),
        utc("2026-01-03T00:00:00Z")
    );
}
