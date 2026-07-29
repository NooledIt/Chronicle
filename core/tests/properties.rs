use chrono::{TimeZone, Timelike, Utc};
use chronicle_core::Schedule;
use proptest::prelude::*;

proptest! {
    #[test]
    fn literal_schedule_is_strictly_future_and_preserves_literals(
        year in 2020_i32..2031,
        month in 1_u32..13,
        day in 1_u32..29,
        hour in 0_u32..24,
        minute in 0_u32..60,
        second in 0_u32..60,
    ) {
        let after = Utc.with_ymd_and_hms(year, month, day, hour, minute, second).single().unwrap();
        let next = Schedule::parse("17 5 * * *").unwrap().next_after(after).unwrap();
        prop_assert!(next > after);
        prop_assert_eq!(next.minute(), 17);
        prop_assert_eq!(next.hour(), 5);
    }

    #[test]
    fn stepped_minutes_stay_on_the_declared_grid(
        year in 2020_i32..2031,
        month in 1_u32..13,
        day in 1_u32..29,
        hour in 0_u32..24,
        minute in 0_u32..60,
    ) {
        let after = Utc.with_ymd_and_hms(year, month, day, hour, minute, 0).single().unwrap();
        let next = Schedule::parse("*/15 * * * *").unwrap().next_after(after).unwrap();
        prop_assert!(next > after);
        prop_assert_eq!(next.minute() % 15, 0);
    }
}

#[test]
fn malformed_expressions_return_errors_instead_of_panicking() {
    for expression in ["", "* * * *", "* * * * * *", "61 * * * *", "*/0 * * * *", "a b c d e"] {
        assert!(Schedule::parse(expression).is_err(), "{expression}");
    }
}
