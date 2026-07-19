//! Calendar-correct ISO-8601 / SQL-datetime formatting + parsing, in ONE place, via the `time` crate.
//!
//! This replaces four hand-rolled proleptic-Gregorian implementations spread across the sidecar +
//! reapers — with TWO distinct civil-date algorithms, one of which had already produced a real
//! leap-year bug (see the git history of `sidecar/dispatch.rs`). `time` is battle-tested and
//! self-consistent, so the emit↔parse round-trip the reapers depend on is exact by construction, and a
//! whole class of leap-year / round-trip bugs is retired. Native crate — there was never a WASM-size
//! reason to hand-roll this.
//!
//! Every parser returns `None` on any input `time` rejects — malformed, an impossible date (e.g. a
//! 31st February or a leap-second `:60`), or a pre-1970 instant — preserving the reapers' documented
//! "unparseable ⇒ keep, never reap" fallback (a stricter parser only ever makes the reapers MORE
//! conservative, never less).
use std::time::{SystemTime, UNIX_EPOCH};

use time::macros::format_description;
use time::{OffsetDateTime, PrimitiveDateTime};

/// Format a unix-seconds instant as `YYYY-MM-DDTHH:MM:SSZ`.
pub(crate) fn epoch_secs_to_iso(secs: u64) -> String {
    let fmt = format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z");
    OffsetDateTime::from_unix_timestamp(secs as i64)
        .ok()
        .and_then(|dt| dt.format(&fmt).ok())
        .unwrap_or_default()
}

/// The current instant as `YYYY-MM-DDTHH:MM:SSZ` (seconds precision).
pub(crate) fn now_iso_seconds() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    epoch_secs_to_iso(secs)
}

/// The current instant as `YYYY-MM-DDTHH:MM:SS.sssZ` (millisecond precision), for durable activity lines.
pub(crate) fn now_iso_millis() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let fmt = format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");
    OffsetDateTime::from_unix_timestamp_nanos(nanos as i128)
        .ok()
        .and_then(|dt| dt.format(&fmt).ok())
        .unwrap_or_default()
}

/// Parse `YYYY-MM-DDThh:mm:ssZ` (as `epoch_secs_to_iso` emits) back to unix seconds. `None` on any
/// malformed or pre-1970 input, so the caller treats it as "keep".
pub(crate) fn iso_to_epoch_secs(iso: &str) -> Option<u64> {
    let fmt = format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z");
    let ts = PrimitiveDateTime::parse(iso, &fmt).ok()?.assume_utc().unix_timestamp();
    (ts >= 0).then_some(ts as u64)
}

/// Parse a SQLite `datetime('now')` string — `YYYY-MM-DD HH:MM:SS` (space, no T/Z, UTC) — to unix
/// seconds. `None` on any malformed or pre-1970 input ⇒ keep.
pub(crate) fn sql_datetime_to_epoch_secs(s: &str) -> Option<u64> {
    let fmt = format_description!("[year]-[month]-[day] [hour]:[minute]:[second]");
    let ts = PrimitiveDateTime::parse(s, &fmt).ok()?.assume_utc().unix_timestamp();
    (ts >= 0).then_some(ts as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_secs_to_iso_is_exact() {
        assert_eq!(epoch_secs_to_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(epoch_secs_to_iso(2_000_000_000), "2033-05-18T03:33:20Z");
    }

    #[test]
    fn iso_round_trips_through_epoch() {
        for secs in [0u64, 1_000_000, 2_000_000_000, 4_000_000_000] {
            assert_eq!(iso_to_epoch_secs(&epoch_secs_to_iso(secs)), Some(secs), "{secs}");
        }
    }

    #[test]
    fn iso_rejects_malformed_and_impossible_and_pre_1970() {
        for bad in [
            "",
            "not-a-date",
            "2033-05-18T03:33:00",  // missing Z
            "2033-13-18T03:33:00Z", // month 13
            "2033-05-18 03:33:00Z", // space, not T
            "20330518T033300Z",     // no separators
        ] {
            assert_eq!(iso_to_epoch_secs(bad), None, "{bad}");
        }
        // Impossible dates the OLD hand-rolled parser accepted are now rejected → "keep" (safe, stricter).
        assert_eq!(iso_to_epoch_secs("2033-05-18T03:33:60Z"), None, "leap second :60");
        assert_eq!(iso_to_epoch_secs("2033-02-31T00:00:00Z"), None, "Feb 31");
        assert_eq!(iso_to_epoch_secs("1969-12-31T23:59:59Z"), None, "pre-1970 → keep");
    }

    #[test]
    fn sql_datetime_round_trips_and_rejects() {
        // The SQL form is the ISO form with 'T' → space and no trailing Z.
        let sql = epoch_secs_to_iso(2_000_000_000).replace('T', " ").trim_end_matches('Z').to_string();
        assert_eq!(sql_datetime_to_epoch_secs(&sql), Some(2_000_000_000), "{sql}");
        for bad in [
            "",
            "2033-05-18T03:33:20Z", // ISO, wrong format (T/Z)
            "2033-05-18T03:33:20",  // T, not space
            "2033-13-18 03:33:20",  // month 13
            "not-a-date",
        ] {
            assert_eq!(sql_datetime_to_epoch_secs(bad), None, "{bad}");
        }
    }

    #[test]
    fn now_iso_millis_has_the_millisecond_shape() {
        let stamp = now_iso_millis();
        assert_eq!(stamp.len(), 24, "{stamp}"); // YYYY-MM-DDTHH:MM:SS.sssZ
        assert!(stamp.ends_with('Z'));
        assert_eq!(stamp.as_bytes()[19], b'.');
    }
}
