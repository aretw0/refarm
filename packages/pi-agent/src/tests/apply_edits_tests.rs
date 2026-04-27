use super::*;

#[test]
fn apply_edits_basic_replacement() {
    let result = apply_edits("hello world".into(), &[("world", "rust")]).unwrap();
    assert_eq!(result, "hello rust");
}

#[test]
fn apply_edits_multiple_ordered() {
    let result = apply_edits("a b c".into(), &[("a", "x"), ("b", "y")]).unwrap();
    assert_eq!(result, "x y c");
}

#[test]
fn apply_edits_err_when_not_found() {
    let err = apply_edits("hello".into(), &[("missing", "x")]).unwrap_err();
    assert!(err.contains("not found"), "expected 'not found': {err}");
    assert!(err.contains("edit 0"), "must include edit index: {err}");
}

#[test]
fn apply_edits_err_when_ambiguous() {
    let err = apply_edits("aa aa".into(), &[("aa", "bb")]).unwrap_err();
    assert!(err.contains("2 times"), "must report match count: {err}");
    assert!(err.contains("edit 0"), "must include edit index: {err}");
}

#[test]
fn apply_edits_sequential_after_first_replacement() {
    // After first edit changes "foo" to "foo foo", second edit finds 2 occurrences → error.
    let err = apply_edits("foo".into(), &[("foo", "foo foo"), ("foo", "bar")]).unwrap_err();
    assert!(err.contains("2 times"), "second edit should fail: {err}");
}

#[test]
fn apply_edits_empty_edits_passthrough() {
    let result = apply_edits("unchanged".into(), &[]).unwrap();
    assert_eq!(result, "unchanged");
}

