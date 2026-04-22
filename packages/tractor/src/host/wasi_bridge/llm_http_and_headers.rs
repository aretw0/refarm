fn sanitized_plugin_headers(headers: &[(String, String)]) -> Vec<(&str, &str)> {
    const MAX_FORWARDED_HEADER_COUNT: usize = 64;
    const MAX_HEADER_SCAN: usize = 256;
    const MAX_HEADER_NAME_LEN: usize = 128;
    const MAX_HEADER_PAIR_BYTES: usize = 16 * 1024;
    const MAX_HEADER_TOTAL_BYTES: usize = 256 * 1024;

    let mut out = Vec::new();
    let mut seen_names = std::collections::HashSet::new();
    let mut total_bytes = 0usize;

    for (name, value) in headers.iter().take(MAX_HEADER_SCAN) {
        if out.len() >= MAX_FORWARDED_HEADER_COUNT {
            break;
        }

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() || trimmed_name.len() > MAX_HEADER_NAME_LEN {
            continue;
        }

        let n = trimmed_name.to_ascii_lowercase();
        if n.is_empty()
            || crate::host::sensitive_aliases::is_sensitive_plugin_header_name(&n)
            || !is_safe_header_name(trimmed_name)
            || !is_safe_header_value(value)
        {
            continue;
        }

        let pair_bytes = trimmed_name.len().saturating_add(value.len());
        if pair_bytes > MAX_HEADER_PAIR_BYTES {
            continue;
        }
        if !seen_names.insert(n) {
            continue;
        }
        let next_total = total_bytes.saturating_add(pair_bytes);
        if next_total > MAX_HEADER_TOTAL_BYTES {
            continue;
        }
        total_bytes = next_total;
        out.push((trimmed_name, value.as_str()));
    }

    out
}

fn is_safe_header_name(name: &str) -> bool {
    let trimmed = name.trim();
    const MAX_HEADER_NAME_LEN: usize = 128;
    !trimmed.is_empty()
        && trimmed.len() <= MAX_HEADER_NAME_LEN
        && trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

fn is_safe_header_value(value: &str) -> bool {
    const MAX_HEADER_VALUE_LEN: usize = 16 * 1024;
    value.len() <= MAX_HEADER_VALUE_LEN
        && value.is_ascii()
        && value.trim() == value
        && !value.chars().any(|c| c.is_control())
}

fn join_base_url_and_path(base_url: &str, path: &str) -> String {
    let left = base_url.trim().trim_end_matches('/');
    let right = path.trim();
    if right.starts_with('/') {
        format!("{left}{right}")
    } else {
        format!("{left}/{right}")
    }
}

fn read_response_bytes(resp: ureq::Response) -> Result<Vec<u8>, String> {
    const MAX_LLM_RESPONSE_BODY_LEN: usize = 2 * 1024 * 1024;
    let reader = resp.into_reader();
    read_limited_bytes(reader, MAX_LLM_RESPONSE_BODY_LEN, "llm-bridge response body")
}

fn read_limited_bytes(
    mut reader: impl std::io::Read,
    max_len: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    (&mut reader)
        .take(max_len as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|e| format!("response read: {e}"))?;
    if out.len() > max_len {
        return Err(format!("{label} too large"));
    }
    Ok(out)
}

#[cfg(test)]
#[path = "../wasi_bridge_tests.rs"]
mod tests;
