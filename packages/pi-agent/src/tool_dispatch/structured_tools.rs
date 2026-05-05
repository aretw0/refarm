use crate::refarm::plugin::structured_io;

fn parse_format(input: &serde_json::Value) -> Option<structured_io::FileFormat> {
    input["format"].as_str().and_then(|s| match s {
        "json" => Some(structured_io::FileFormat::Json),
        "toml" => Some(structured_io::FileFormat::Toml),
        "yaml" => Some(structured_io::FileFormat::Yaml),
        _ => None,
    })
}

pub(crate) fn read_structured(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    let page_size = input["page_size"].as_u64().unwrap_or(50) as u32;
    let page_offset = input["page_offset"].as_u64().unwrap_or(0) as u32;
    match structured_io::read_structured(path, parse_format(input), page_size, page_offset) {
        Ok(content) => crate::compress_tool_output(&content),
        Err(e) => format!("[read_structured error] {e}"),
    }
}

pub(crate) fn write_structured(input: &serde_json::Value) -> String {
    let path = input["path"].as_str().unwrap_or("");
    let content = input["content"].as_str().unwrap_or("");
    match structured_io::write_structured(path, content, parse_format(input)) {
        Ok(()) => format!("wrote {} bytes to {path} (validated)", content.len()),
        Err(e) => format!("[write_structured error] {e}"),
    }
}
