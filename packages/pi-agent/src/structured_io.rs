/// Detect format from file extension. Falls back to "json" when unknown.
pub(crate) fn detect_format(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".toml") {
        return "toml";
    }
    if lower.ends_with(".yaml") || lower.ends_with(".yml") {
        return "yaml";
    }
    "json"
}

/// Parse `bytes` as `format`, paginate to `page_size` top-level items/keys.
/// Returns a metadata header line followed by the content.
/// `page_size = 0` → return everything.
pub(crate) fn read_structured_parse(
    bytes: &[u8],
    format: &str,
    page_size: usize,
    page_offset: usize,
) -> String {
    let total_bytes = bytes.len();
    match format {
        "json" => parse_and_page_json(bytes, total_bytes, page_size, page_offset),
        "toml" => parse_and_page_toml(bytes, total_bytes, page_size, page_offset),
        "yaml" => parse_and_page_yaml(bytes, total_bytes, page_size, page_offset),
        other => format!("[read_structured | unknown format: {other}]"),
    }
}

fn parse_and_page_json(
    bytes: &[u8],
    total_bytes: usize,
    page_size: usize,
    page_offset: usize,
) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return "[read_structured | json | invalid UTF-8]".into(),
    };
    let v: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | json | parse error: {e}]"),
    };
    page_json_value(v, total_bytes, page_size, page_offset)
}

fn page_json_value(
    v: serde_json::Value,
    total_bytes: usize,
    page_size: usize,
    page_offset: usize,
) -> String {
    if page_size == 0 {
        let content = serde_json::to_string_pretty(&v).unwrap_or_default();
        return format!("[read_structured | json | {total_bytes}B | complete]\n{content}");
    }
    match v {
        serde_json::Value::Array(arr) => {
            let total = arr.len();
            let start = page_offset.min(total);
            let end = (start + page_size).min(total);
            let truncated = end < total;
            let content = serde_json::to_string_pretty(&arr[start..end]).unwrap_or_default();
            let note = if truncated {
                format!("items {}-{} of {} | truncated", start + 1, end, total)
            } else {
                format!("items {}-{} of {}", start + 1, end, total)
            };
            format!("[read_structured | json | {total_bytes}B | {note}]\n{content}")
        }
        serde_json::Value::Object(map) => {
            let total = map.len();
            let paged: serde_json::Map<_, _> =
                map.into_iter().skip(page_offset).take(page_size).collect();
            let shown = paged.len();
            let truncated = page_offset + shown < total;
            let content =
                serde_json::to_string_pretty(&serde_json::Value::Object(paged)).unwrap_or_default();
            let note = if truncated {
                format!("{shown} of {total} keys | truncated")
            } else {
                format!("all {total} keys")
            };
            format!("[read_structured | json | {total_bytes}B | {note}]\n{content}")
        }
        scalar => {
            let content = serde_json::to_string_pretty(&scalar).unwrap_or_default();
            format!("[read_structured | json | {total_bytes}B | scalar]\n{content}")
        }
    }
}

fn parse_and_page_toml(
    bytes: &[u8],
    total_bytes: usize,
    page_size: usize,
    page_offset: usize,
) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return "[read_structured | toml | invalid UTF-8]".into(),
    };
    let table: toml::Value = match toml::from_str(text) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | toml | parse error: {e}]"),
    };
    let json_val: serde_json::Value = match serde_json::to_value(&table) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | toml | conversion error: {e}]"),
    };
    page_json_value(json_val, total_bytes, page_size, page_offset)
        .replacen("| json |", "| toml |", 1)
}

fn parse_and_page_yaml(
    bytes: &[u8],
    total_bytes: usize,
    page_size: usize,
    page_offset: usize,
) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return "[read_structured | yaml | invalid UTF-8]".into(),
    };
    let yaml_val: serde_yaml::Value = match serde_yaml::from_str(text) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | yaml | parse error: {e}]"),
    };
    // Convert YAML → JSON for uniform pagination (serde_yaml::Value → serde_json::Value).
    let json_val: serde_json::Value = match serde_json::to_value(&yaml_val) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | yaml | conversion error: {e}]"),
    };
    page_json_value(json_val, total_bytes, page_size, page_offset)
        .replacen("| json |", "| yaml |", 1)
}

/// Validate `content` as `format` (json/toml/yaml). Returns `Ok(())` when valid,
/// `Err(message)` with a human-readable parse error when invalid.
pub(crate) fn validate_structured(content: &str, format: &str) -> Result<(), String> {
    match format {
        "json" => serde_json::from_str::<serde_json::Value>(content)
            .map(|_| ())
            .map_err(|e| format!("JSON parse error: {e}")),
        "toml" => toml::from_str::<toml::Value>(content)
            .map(|_| ())
            .map_err(|e| format!("TOML parse error: {e}")),
        "yaml" => serde_yaml::from_str::<serde_yaml::Value>(content)
            .map(|_| ())
            .map_err(|e| format!("YAML parse error: {e}")),
        other => Err(format!("unsupported format: {other}")),
    }
}

/// Apply ordered string replacements to `content`. Returns `Err` with a human message
/// if any `old_str` is missing or appears more than once.
pub(crate) fn apply_edits(
    mut content: String,
    edits: &[(/* old */ &str, /* new */ &str)],
) -> Result<String, String> {
    for (i, (old, new)) in edits.iter().enumerate() {
        let count = content.matches(old).count();
        if count == 0 {
            return Err(format!("edit {i}: old_str not found"));
        }
        if count > 1 {
            return Err(format!(
                "edit {i}: old_str matches {count} times — be more specific"
            ));
        }
        content = content.replacen(old, new, 1);
    }
    Ok(content)
}
