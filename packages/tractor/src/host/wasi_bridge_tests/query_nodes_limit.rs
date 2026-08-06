// `query_nodes` (the `tractor-bridge` WIT host call) must return the NEWEST `limit`
// rows of a type, not merely `limit` rows in whatever order the store happens to
// produce. See docs/SOVEREIGN_RECORD_ORDERING.md for the invariant this rides on.

#[test]
fn query_nodes_returns_the_newest_limit_rows_in_newest_first_order() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    // A second handle onto the SAME connection (`NativeStorage::clone` is O(1), an
    // `Arc<Mutex<Connection>>` share) so `updated_at` can be stamped directly —
    // `store_node` derives it internally via `datetime('now')` and cannot be handed
    // a fixed value.
    let storage_for_timestamps = storage.clone();
    let sync = crate::sync::NativeSync::new(storage, "query-nodes-limit-test").unwrap();

    // Insert in an order that, if `updated_at` were dropped from the ORDER BY, would
    // make "c" (highest id, last inserted) look right by `id DESC` alone — the exact
    // trap this session hit four times. Distinct `updated_at` values, INVERTED
    // against id order (lowest id "a" gets the NEWEST timestamp), so the assertion
    // below can only be satisfied by respecting `updated_at`, never by id order.
    sync.store_node("a", "Thing", None, r#"{"n":1}"#, None).unwrap();
    sync.store_node("b", "Thing", None, r#"{"n":2}"#, None).unwrap();
    sync.store_node("c", "Thing", None, r#"{"n":3}"#, None).unwrap();
    storage_for_timestamps
        .execute(
            "UPDATE nodes SET updated_at = '2026-01-01T00:00:03Z' WHERE id = 'a'",
            &[],
        )
        .unwrap();
    storage_for_timestamps
        .execute(
            "UPDATE nodes SET updated_at = '2026-01-01T00:00:02Z' WHERE id = 'b'",
            &[],
        )
        .unwrap();
    storage_for_timestamps
        .execute(
            "UPDATE nodes SET updated_at = '2026-01-01T00:00:01Z' WHERE id = 'c'",
            &[],
        )
        .unwrap();

    let telemetry = crate::telemetry::TelemetryBus::new(16);
    let mut bindings = super::TractorNativeBindings::new(
        "agent",
        sync,
        telemetry,
        crate::host::host_effects_bridge::HostEffectPolicy::default(),
        crate::host::wasi_bridge::ModelRoute::for_test(
            "ollama",
            "http://127.0.0.1:9",
            "/v1/chat/completions",
        ),
        None,
        crate::host::wasi_bridge::PermissionGrant::permissive(),
        None,
        None,
        std::sync::Arc::new(crate::host::host_effects_bridge::ConnectionRegistry::new()),
    );

    // Ask for 2 of the 3 stored "Thing" rows through the SAME host call a guest
    // plugin uses (`TractorBridgeHost::query_nodes`), not the storage layer directly.
    let payloads = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(super::TractorBridgeHost::query_nodes(
            &mut bindings,
            "Thing".to_string(),
            2,
        ))
        .unwrap();

    assert_eq!(
        payloads,
        vec![r#"{"n":1}"#.to_string(), r#"{"n":2}"#.to_string()],
        "limit=2 over 3 stored rows must return the NEWEST two, NEWEST FIRST: 'a' \
         (newest updated_at) then 'b'. 'c' has the HIGHEST id but the OLDEST \
         updated_at — if the limit were taken from the wrong end (oldest-first), or \
         if the ordering fell back to id DESC alone, 'c' and/or 'b' would appear in \
         place of 'a', or the order would come back reversed."
    );
}
