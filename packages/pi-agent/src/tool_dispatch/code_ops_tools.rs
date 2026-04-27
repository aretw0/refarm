use crate::refarm::plugin::code_ops::{self, SymbolLocation};

pub(crate) fn find_references(input: &serde_json::Value) -> String {
    let file = input["file"].as_str().unwrap_or("");
    let line = input["line"].as_u64().unwrap_or(0) as u32;
    let column = input["column"].as_u64().unwrap_or(0) as u32;
    let loc = SymbolLocation {
        file: file.to_string(),
        line,
        column,
    };
    match code_ops::find_references(&loc) {
        Ok(refs) => {
            let items: Vec<_> = refs
                .iter()
                .map(|r| {
                    serde_json::json!({"file": r.file, "line": r.line, "column": r.column, "kind": r.kind})
                })
                .collect();
            serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".into())
        }
        Err(e) => format!("[find_references error] {e}"),
    }
}

pub(crate) fn rename_symbol(input: &serde_json::Value) -> String {
    let file = input["file"].as_str().unwrap_or("");
    let line = input["line"].as_u64().unwrap_or(0) as u32;
    let column = input["column"].as_u64().unwrap_or(0) as u32;
    let new_name = input["new_name"].as_str().unwrap_or("");
    if new_name.is_empty() {
        return "[error] rename_symbol requires new_name".into();
    }
    let loc = SymbolLocation {
        file: file.to_string(),
        line,
        column,
    };
    match code_ops::rename_symbol(&loc, new_name) {
        Ok(r) => format!(
            "renamed: {} files changed, {} edits applied",
            r.files_changed, r.edits_applied
        ),
        Err(e) => format!("[rename_symbol error] {e}"),
    }
}
