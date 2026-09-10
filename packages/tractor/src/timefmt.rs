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

/// Parse an ISO-8601 UTC instant back to unix MILLISECONDS, accepting BOTH shapes this system
/// produces: the seconds shape `YYYY-MM-DDThh:mm:ssZ` (`epoch_secs_to_iso`, `now_iso_seconds`) and
/// the millisecond shape `YYYY-MM-DDThh:mm:ss.sssZ` (`now_iso_millis`, and every JavaScript client,
/// since `Date.prototype.toISOString` has no seconds-only form).
///
/// Accepting both is not leniency for its own sake — it closes a real production hole. A
/// seconds-only parser silently rejected every wire timestamp this repo receives: `submittedAt` is
/// stamped by `farm-client`'s `effort.mjs`, the CLI's `task.ts`, and `automation-contract-v1`'s
/// `nowIso()`, all three via `new Date().toISOString()`, all three with `.sss`. The unit tests never
/// caught it because their fixtures used the seconds shape no client emits.
pub(crate) fn iso_to_epoch_millis(iso: &str) -> Option<u64> {
    let with_millis =
        format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");
    let with_secs = format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z");
    let parsed = PrimitiveDateTime::parse(iso, &with_millis)
        .or_else(|_| PrimitiveDateTime::parse(iso, &with_secs))
        .ok()?;
    let ts = parsed.assume_utc().unix_timestamp_nanos() / 1_000_000;
    (ts >= 0).then_some(ts as u64)
}

/// Parse the same instants back to unix seconds, truncating any sub-second part. `None` on any
/// malformed or pre-1970 input, so the reapers treat it as "keep".
pub(crate) fn iso_to_epoch_secs(iso: &str) -> Option<u64> {
    iso_to_epoch_millis(iso).map(|ms| ms / 1_000)
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

    /// The regression this file's `iso_to_epoch_millis` doc describes: EVERY client stamps
    /// `submittedAt` with `new Date().toISOString()`, which always carries `.sss`. A seconds-only
    /// parser returned `None` for all of them, so `refarm.elapsed_ms` was omitted from every real
    /// observation while the fixtures — written in the seconds shape — reported a passing parse.
    #[test]
    fn parses_the_millisecond_shape_every_client_actually_sends() {
        assert_eq!(iso_to_epoch_millis("2033-05-18T03:33:20.123Z"), Some(2_000_000_000_123));
        assert_eq!(iso_to_epoch_secs("2033-05-18T03:33:20.123Z"), Some(2_000_000_000));
        // …without losing the seconds shape the reapers and `epoch_secs_to_iso` still emit.
        assert_eq!(iso_to_epoch_millis("2033-05-18T03:33:20Z"), Some(2_000_000_000_000));
        // Sub-second differences survive as sub-second differences, which is the whole point:
        // an effort faster than a second must not measure as zero.
        let start = iso_to_epoch_millis("2026-08-04T12:00:00.100Z").expect("start");
        let end = iso_to_epoch_millis("2026-08-04T12:00:00.440Z").expect("end");
        assert_eq!(end - start, 340, "a 340ms effort must measure 340ms, not 0");
    }

    #[test]
    fn millis_parser_rejects_what_the_seconds_parser_rejects() {
        for bad in [
            "",
            "not-a-date",
            "2033-05-18T03:33:00.123",   // missing Z
            "2033-13-18T03:33:00.123Z",  // month 13
            "2033-05-18 03:33:00.123Z",  // space, not T
            "2033-05-18T03:33:60.123Z",  // leap second :60
            "2033-02-31T00:00:00.123Z",  // Feb 31
            "1969-12-31T23:59:59.999Z",  // pre-1970 → keep
            "2033-05-18T03:33:20.1234Z", // four subsecond digits, not three
        ] {
            assert_eq!(iso_to_epoch_millis(bad), None, "{bad}");
            assert_eq!(iso_to_epoch_secs(bad), None, "{bad}");
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
