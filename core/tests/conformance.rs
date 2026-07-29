use chrono::{DateTime, Utc};
use chronicle_core::Schedule;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    expression: String,
    after: String,
    expected: String,
}

#[test]
fn json_contract_fixtures_are_independent_of_the_implementation() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("../../conformance/utc-fixtures.json"))
        .expect("valid fixture JSON");
    for fixture in fixtures {
        let schedule = Schedule::parse(&fixture.expression).expect("valid fixture expression");
        let after = fixture.after.parse::<DateTime<Utc>>().expect("valid fixture start");
        let expected = fixture.expected.parse::<DateTime<Utc>>().expect("valid fixture expected occurrence");
        assert_eq!(schedule.next_after(after).unwrap(), expected, "{}", fixture.expression);
    }
}
