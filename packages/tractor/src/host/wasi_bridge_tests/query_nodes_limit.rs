// `query_nodes` (the `tractor-bridge` WIT host call) must return the NEWEST `limit`
// rows of a type, not merely `limit` rows in whatever order the store happens to
// produce — see docs/SOVEREIGN_RECORD_ORDERING.md for the ordering invariant this
// rides on — AND, since 2026-08-06, it must return a `NodePage` record that tells the
// guest whether the answer it got was the whole story: `stored` is the true count of
// rows of the type (via `count_nodes`, independent of `limit`), and `truncated` is
// true only when `stored` exceeds how many rows `nodes` actually carries. Before this,
// `query-nodes` returned a bare `list<json-ld-node>` and a guest receiving exactly
// `limit` rows had no way to tell a complete answer from a cut one — the budget guard
// in the agent (`packages/agent/src/session/wasm_ops.rs`) summed a possibly-truncated
// set of UsageRecords and called it "under budget" either way.

fn open_bindings(
    sync: crate::sync::NativeSync,
) -> super::TractorNativeBindings {
    let telemetry = crate::telemetry::TelemetryBus::new(16);
    super::TractorNativeBindings::new(
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
    )
}

fn block_on_query_nodes(
    bindings: &mut super::TractorNativeBindings,
    node_type: &str,
    limit: u32,
) -> super::NodePage {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(super::TractorBridgeHost::query_nodes(
            bindings,
            node_type.to_string(),
            limit,
        ))
        .unwrap()
}

#[test]
fn query_nodes_reports_stored_and_truncated_when_more_rows_exist_than_limit() {
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

    let mut bindings = open_bindings(sync);

    // Ask for 2 of the 3 stored "Thing" rows through the SAME host call a guest
    // plugin uses (`TractorBridgeHost::query_nodes`), not the storage layer directly.
    let page = block_on_query_nodes(&mut bindings, "Thing", 2);

    assert_eq!(
        page.nodes,
        vec![r#"{"n":1}"#.to_string(), r#"{"n":2}"#.to_string()],
        "limit=2 over 3 stored rows must return the NEWEST two, NEWEST FIRST: 'a' \
         (newest updated_at) then 'b'. 'c' has the HIGHEST id but the OLDEST \
         updated_at — if the limit were taken from the wrong end (oldest-first), or \
         if the ordering fell back to id DESC alone, 'c' and/or 'b' would appear in \
         place of 'a', or the order would come back reversed."
    );
    assert_eq!(
        page.stored, 3,
        "stored must be the TRUE total of 'Thing' rows (3), independent of the \
         limit=2 the caller asked for — it comes from count_nodes, not nodes.len()."
    );
    assert!(
        page.truncated,
        "3 stored rows with limit=2 must report truncated=true: the caller did not \
         see everything."
    );
}

#[test]
fn query_nodes_reports_not_truncated_when_limit_covers_every_stored_row() {
    let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
    let storage_for_timestamps = storage.clone();
    let sync = crate::sync::NativeSync::new(storage, "query-nodes-limit-complete-test").unwrap();

    // Only 2 rows stored, but id order and updated_at order still DISAGREE — "x" has
    // the lower id yet the newer timestamp, "y" the higher id yet the older
    // timestamp — so a passing assertion here still cannot be explained by an
    // implementation that silently fell back to `id DESC`.
    sync.store_node("x", "Widget", None, r#"{"n":1}"#, None).unwrap();
    sync.store_node("y", "Widget", None, r#"{"n":2}"#, None).unwrap();
    storage_for_timestamps
        .execute(
            "UPDATE nodes SET updated_at = '2026-01-01T00:00:02Z' WHERE id = 'x'",
            &[],
        )
        .unwrap();
    storage_for_timestamps
        .execute(
            "UPDATE nodes SET updated_at = '2026-01-01T00:00:01Z' WHERE id = 'y'",
            &[],
        )
        .unwrap();

    let mut bindings = open_bindings(sync);

    // limit=5 is larger than the 2 rows actually stored — the case the brief calls
    // out by name: a limit bigger than the total must still report truncated=false,
    // never true-because-the-caller-asked-for-a-round-number.
    let page = block_on_query_nodes(&mut bindings, "Widget", 5);

    assert_eq!(
        page.nodes,
        vec![r#"{"n":1}"#.to_string(), r#"{"n":2}"#.to_string()],
        "newest first: 'x' (newest updated_at) then 'y', despite 'y' having the \
         higher id."
    );
    assert_eq!(
        page.stored, 2,
        "stored must equal the true total (2) even though limit (5) was larger."
    );
    assert!(
        !page.truncated,
        "everything that exists fit in `nodes` (2 stored, 2 returned) — truncated \
         must be false. Deriving truncated from `limit` instead of from `stored` vs. \
         `nodes.len()` would wrongly report truncated=true whenever a caller's limit \
         happened to be larger than the total, which this case exists to catch."
    );
}
