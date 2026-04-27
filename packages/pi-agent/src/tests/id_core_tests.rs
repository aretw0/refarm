use super::*;

#[test]
fn new_id_is_unique() {
    let ids: Vec<_> = (0..20).map(|_| new_id()).collect();
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!(ids.len(), unique.len());
}

#[test]
fn new_id_format_is_non_empty_and_unique() {
    let id = new_id();
    assert!(!id.is_empty(), "new_id must not be empty");
    assert!(id.len() >= 20, "new_id must be at least 20 chars: {id}");
}

#[test]
fn now_ns_is_non_zero() {
    assert!(now_ns() > 0);
}

