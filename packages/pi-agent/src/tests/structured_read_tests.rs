use super::*;

#[test]
fn detect_format_from_extension() {
    assert_eq!(detect_format("/a/b.json"), "json");
    assert_eq!(detect_format("/a/b.toml"), "toml");
    assert_eq!(detect_format("/a/b.yaml"), "yaml");
    assert_eq!(detect_format("/a/b.yml"), "yaml");
    assert_eq!(detect_format("/a/b.rs"), "json"); // fallback
    assert_eq!(detect_format("/a/b.JSON"), "json"); // case-insensitive
}

#[test]
fn read_structured_json_array_paginated() {
    let data: Vec<serde_json::Value> = (1..=100).map(|i| serde_json::json!({"id": i})).collect();
    let bytes = serde_json::to_vec(&data).unwrap();
    let result = read_structured_parse(&bytes, "json", 10, 0);
    assert!(result.contains("items 1-10 of 100"), "header: {result}");
    assert!(result.contains("truncated"), "should be truncated: {result}");
    let parsed: serde_json::Value =
        serde_json::from_str(result.lines().skip(1).collect::<Vec<_>>().join("\n").as_str())
            .unwrap();
    assert_eq!(parsed.as_array().unwrap().len(), 10);
}

#[test]
fn read_structured_json_array_page_offset() {
    let data: Vec<serde_json::Value> = (1..=20).map(|i| serde_json::json!(i)).collect();
    let bytes = serde_json::to_vec(&data).unwrap();
    let result = read_structured_parse(&bytes, "json", 5, 10);
    assert!(result.contains("items 11-15 of 20"), "header: {result}");
    let parsed: serde_json::Value =
        serde_json::from_str(result.lines().skip(1).collect::<Vec<_>>().join("\n").as_str())
            .unwrap();
    assert_eq!(parsed[0], 11);
}

#[test]
fn read_structured_json_object_paginated() {
    let obj: serde_json::Value = (b'a'..=b'z')
        .map(|c| (String::from(c as char), serde_json::Value::from(c as i32)))
        .collect::<serde_json::Map<_, _>>()
        .into();
    let bytes = serde_json::to_vec(&obj).unwrap();
    let result = read_structured_parse(&bytes, "json", 5, 0);
    assert!(result.contains("5 of 26 keys"), "header: {result}");
    assert!(result.contains("truncated"));
}

#[test]
fn read_structured_tasks_json_pagination() {
    // Simulate a tasks.json-shaped file: {"tasks": [...354 items...]}
    let tasks: Vec<serde_json::Value> = (1..=354)
        .map(|i| serde_json::json!({"id": format!("T-{i:04}"), "status": "planned"}))
        .collect();
    let data = serde_json::json!({"tasks": tasks});
    let bytes = serde_json::to_vec(&data).unwrap();
    let result = read_structured_parse(&bytes, "json", 50, 0);
    // It's an object with 1 key ("tasks"), so only that key is shown
    assert!(
        result.contains("1 of 1 keys") || result.contains("all 1 keys"),
        "header: {result}"
    );
}

#[test]
fn read_structured_tasks_json_array_at_root() {
    // If tasks.json had an array at root, pagination works correctly
    let tasks: Vec<serde_json::Value> = (1..=354)
        .map(|i| serde_json::json!({"id": format!("T-{i:04}"), "status": "planned"}))
        .collect();
    let bytes = serde_json::to_vec(&tasks).unwrap();
    let result = read_structured_parse(&bytes, "json", 50, 0);
    assert!(result.contains("items 1-50 of 354"), "header: {result}");
    assert!(result.contains("truncated"));
}

#[test]
fn read_structured_json_no_truncation_when_small() {
    let data = serde_json::json!([1, 2, 3]);
    let bytes = serde_json::to_vec(&data).unwrap();
    let result = read_structured_parse(&bytes, "json", 50, 0);
    assert!(result.contains("items 1-3 of 3"), "header: {result}");
    assert!(
        !result.contains("truncated"),
        "small file must not be truncated"
    );
}

#[test]
fn read_structured_toml_parses_cargo_toml() {
    let cargo = r#"
[package]
name = "pi-agent"
version = "0.1.0"

[dependencies]
serde_json = "1"
"#;
    let result = read_structured_parse(cargo.as_bytes(), "toml", 0, 0);
    assert!(result.contains("toml"), "header must say toml: {result}");
    assert!(
        result.contains("pi-agent") || result.contains("package"),
        "content: {result}"
    );
}

#[test]
fn read_structured_yaml_simple_mapping() {
    let yaml = b"name: pi-agent\nversion: 0.1.0\nauthor: arthur\n";
    let result = read_structured_parse(yaml, "yaml", 0, 0);
    assert!(result.contains("yaml"), "header must say yaml: {result}");
    assert!(result.contains("pi-agent"), "content must include value: {result}");
}

#[test]
fn read_structured_yaml_sequence_paginated() {
    let items: Vec<String> = (1..=50).map(|i| format!("- item{i}")).collect();
    let yaml = items.join("\n").into_bytes();
    let result = read_structured_parse(&yaml, "yaml", 10, 0);
    assert!(result.contains("yaml"), "header: {result}");
    assert!(result.contains("items 1-10 of 50"), "pagination: {result}");
    assert!(result.contains("truncated"), "truncation: {result}");
}

#[test]
fn read_structured_yaml_github_actions_workflow() {
    let workflow = b"
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo test
";
    let result = read_structured_parse(workflow, "yaml", 0, 0);
    assert!(result.contains("yaml"), "header: {result}");
    assert!(
        result.contains("CI") || result.contains("name"),
        "content: {result}"
    );
}

#[test]
fn read_structured_yaml_detect_from_extension() {
    assert_eq!(detect_format("/path/to/.github/workflows/ci.yml"), "yaml");
    assert_eq!(detect_format("/path/to/docker-compose.yaml"), "yaml");
}

#[test]
fn read_structured_invalid_json_returns_error() {
    let result = read_structured_parse(b"{not valid json", "json", 50, 0);
    assert!(result.contains("parse error"), "must report parse error: {result}");
}

