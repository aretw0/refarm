use super::*;

#[test]
fn validate_structured_json_valid() {
    assert!(validate_structured(r#"{"key":"value","n":42}"#, "json").is_ok());
}

#[test]
fn validate_structured_json_invalid_returns_error() {
    let result = validate_structured("{not json}", "json");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("JSON parse error"));
}

#[test]
fn validate_structured_toml_valid() {
    let toml = "[package]\nname = \"pi-agent\"\nversion = \"0.1.0\"\n";
    assert!(validate_structured(toml, "toml").is_ok());
}

#[test]
fn validate_structured_toml_invalid_returns_error() {
    let result = validate_structured("name = missing_quotes\n[[[bad", "toml");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("TOML parse error"));
}

#[test]
fn validate_structured_yaml_valid() {
    let yaml = "name: pi-agent\nversion: 0.1.0\n";
    assert!(validate_structured(yaml, "yaml").is_ok());
}

#[test]
fn validate_structured_yaml_invalid_returns_error() {
    let result = validate_structured("key: [unclosed bracket", "yaml");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("YAML parse error"));
}

#[test]
fn validate_structured_unknown_format_returns_error() {
    let result = validate_structured("data", "xml");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("unsupported format"));
}

