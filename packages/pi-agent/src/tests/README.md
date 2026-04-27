# pi-agent unit test map

`src/tests.rs` is intentionally thin and only wires domain modules.

Domain slices:
- `compress_tests.rs` — output compaction + hash primitives
- `runtime_response_schema_tests.rs` — native stub + AgentResponse shape
- `session_schema_tests.rs` / `history_tree_tests.rs` / `history_nodes_tests.rs` — session/history behavior
- `structured_read_tests.rs` / `structured_validate_tests.rs` — structured I/O parsing and validation
- `provider_env_tests.rs` / `provider_config_tests.rs` — provider selection/defaults
- `runtime_cost_guard_tests.rs` / `budget_tests.rs` / `system_prompt_tests.rs` — runtime guards and env behavior
- `tools_schema_tests.rs` / `apply_edits_tests.rs` — tool contracts and edit semantics
- `response_nodes_tests.rs` / `usage_record_schema_tests.rs` / `id_*_tests.rs` — CRDT builders and id primitives
