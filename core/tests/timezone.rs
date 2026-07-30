use chronicle_core::{DstPolicy, Schedule};
use chrono::{DateTime, Utc};
use chrono_tz::America::New_York;

fn utc(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

#[test]
fn fall_back_can_emit_the_repeated_wall_clock_minute_once_or_twice() {
    let schedule = Schedule::parse("30 1 * * *").unwrap();
    let first = utc("2026-11-01T05:30:00Z");
    let second = utc("2026-11-01T06:30:00Z");

    assert_eq!(
        schedule
            .next_after_in_timezone(
                utc("2026-11-01T05:29:00Z"),
                New_York,
                DstPolicy::WallClockOnce
            )
            .unwrap(),
        first,
    );
    assert_eq!(
        schedule
            .next_after_in_timezone(first, New_York, DstPolicy::WallClockOnce)
            .unwrap(),
        utc("2026-11-02T06:30:00Z"),
    );
    assert_eq!(
        schedule
            .next_after_in_timezone(first, New_York, DstPolicy::WallClockTwice)
            .unwrap(),
        second,
    );
}

#[test]
fn fall_back_orders_real_instants_even_when_wall_clock_time_repeats() {
    let every_minute = Schedule::parse("0 * 1 * * *").unwrap();
    let halfway_through_first_hour = utc("2026-11-01T05:45:00Z");
    assert_eq!(
        every_minute
            .next_after_in_timezone(
                halfway_through_first_hour,
                New_York,
                DstPolicy::WallClockTwice,
            )
            .unwrap(),
        utc("2026-11-01T05:46:00Z")
    );

    let repeated_early_minute = Schedule::parse("30 1 * * *").unwrap();
    assert_eq!(
        repeated_early_minute
            .next_after_in_timezone(
                halfway_through_first_hour,
                New_York,
                DstPolicy::WallClockTwice,
            )
            .unwrap(),
        utc("2026-11-01T06:30:00Z")
    );

    let halfway_through_second_hour = utc("2026-11-01T06:45:00Z");
    assert_eq!(
        every_minute
            .next_after_in_timezone(
                halfway_through_second_hour,
                New_York,
                DstPolicy::WallClockTwice,
            )
            .unwrap(),
        utc("2026-11-01T06:46:00Z")
    );
}

#[test]
fn spring_forward_skips_nonexistent_wall_clock_minutes() {
    let schedule = Schedule::parse("30 2 * * *").unwrap();
    assert_eq!(
        schedule
            .next_after_in_timezone(
                utc("2026-03-08T06:00:00Z"),
                New_York,
                DstPolicy::WallClockTwice
            )
            .unwrap(),
        utc("2026-03-09T06:30:00Z"),
    );
}

#[test]
fn utc_api_remains_deterministic() {
    let schedule = Schedule::parse("0 9 * * *").unwrap();
    assert_eq!(
        schedule.next_after(utc("2026-03-08T08:59:00Z")).unwrap(),
        utc("2026-03-08T09:00:00Z")
    );
}
