/// Append the host's registry-contributed agent tools (the AGENT LEG, #6) to a
/// built-in tool array. The host owns the capability registry and pre-renders each
/// agent-eligible verb as a provider-shaped tool schema (a JSON object string);
/// this parses and concatenates them so the built-in and plugin tools reach the
/// model as ONE indistinguishable list — the flat-merge model curated from pi.
///
/// Resilient by design: a schema string the host sends that fails to parse is
/// skipped, never poisoning the request. `provider` is "anthropic" or "openai" so
/// the host renders the matching envelope. On non-wasm targets (unit tests, host
/// builds) there is no host import, so the base list is returned unchanged.
#[cfg(target_arch = "wasm32")]
fn with_registry_tools(mut base: serde_json::Value, provider: &str) -> serde_json::Value {
    let schemas = crate::plugin::host::capability_tools::list_tools(provider);
    if let Some(array) = base.as_array_mut() {
        for schema in schemas {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&schema) {
                array.push(value);
            }
        }
    }
    base
}

#[cfg(not(target_arch = "wasm32"))]
fn with_registry_tools(base: serde_json::Value, _provider: &str) -> serde_json::Value {
    base
}

/// Built-in + registry-contributed tools in the Anthropic wire shape. The request
/// builder calls THIS (not the bare built-in list) so a plugin verb that opted into
/// the agent surface reaches the model as a first-class tool.
pub(crate) fn tools_anthropic_with_registry() -> serde_json::Value {
    with_registry_tools(tools_anthropic(), "anthropic")
}

/// Built-in + registry-contributed tools in the OpenAI wire shape.
pub(crate) fn tools_openai_with_registry() -> serde_json::Value {
    with_registry_tools(tools_openai(), "openai")
}

pub(crate) fn tools_anthropic() -> serde_json::Value {
    serde_json::json!([
        {"name":"read_file","description":"Read the contents of a file at an absolute path. Large files are pageable: use limit to cap lines returned and offset to start at a later line.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path"},"limit":{"type":"integer","description":"Max lines to return (default 300; 0 = all)"},"offset":{"type":"integer","description":"0-based line to start reading from (default 0)"}},"required":["path"]}},
        {"name":"write_file","description":"Write UTF-8 content to a file atomically.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}},
        {"name":"edit_file","description":"Apply one or more targeted string replacements to a file. Each edit replaces old_str with new_str; fails if old_str is not found or appears more than once.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to the file"},"edits":{"type":"array","items":{"type":"object","properties":{"old_str":{"type":"string"},"new_str":{"type":"string"}},"required":["old_str","new_str"]},"description":"Ordered list of replacements to apply"}},"required":["path","edits"]}},
        {"name":"apply_patch","description":"Apply a unified diff to a file in one shot (the large-refactor complement to edit_file). Applied atomically; fails if the diff context does not match the current file, so a stale patch is rejected rather than half-applied. Prefer this when changing several hunks of one file.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to the file"},"patch":{"type":"string","description":"A unified diff (---/+++/@@ hunks) to apply to the file"}},"required":["path","patch"]}},
        {"name":"list_dir","description":"List files and directories at a path.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to directory"}},"required":["path"]}},
        {"name":"search_files","description":"Search for a pattern in files (grep). Returns matching lines with file:line prefix.",
         "input_schema":{"type":"object","properties":{"pattern":{"type":"string","description":"Regular expression to search for"},"path":{"type":"string","description":"Absolute path to search in"},"glob":{"type":"string","description":"Optional filename glob filter, e.g. *.rs"},"max_results":{"type":"integer","description":"Cap on matching lines returned (default 100; 0 = all)"}},"required":["pattern","path"]}},
        {"name":"glob","description":"Find files BY NAME matching a glob (e.g. *.rs, Cargo.toml) recursively under a path — the locate-files complement to search_files (which greps content) and list_dir (one directory). Returns one path per line.",
         "input_schema":{"type":"object","properties":{"pattern":{"type":"string","description":"Filename glob, e.g. *.rs or Cargo.toml"},"path":{"type":"string","description":"Absolute path to search under (default .)"},"max_results":{"type":"integer","description":"Cap on paths returned (default 100; 0 = all)"}},"required":["pattern"]}},
        {"name":"bash","description":"Run a command via structured argv (argv[0] is the binary, no shell expansion).",
         "input_schema":{"type":"object","properties":{"argv":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"},"timeout_ms":{"type":"integer"}},"required":["argv"]}},
        {"name":"read_structured","description":"Parse a structured file (JSON, TOML, YAML) and return its content with automatic pagination for large files. Use page_size to control how many items/keys to return. Returns a metadata header followed by content.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to the file"},"format":{"type":"string","enum":["json","toml","yaml"],"description":"File format (auto-detected from extension if omitted)"},"page_size":{"type":"integer","description":"Max items/keys to return (default 50; 0 = return all)"},"page_offset":{"type":"integer","description":"Skip this many items/keys before returning (default 0)"}},"required":["path"]}},
        {"name":"write_structured","description":"Validate and write structured content (JSON, TOML, YAML) to a file atomically. Validates syntax before writing — invalid content returns an error without touching the file.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to write"},"content":{"type":"string","description":"The structured content to write"},"format":{"type":"string","enum":["json","toml","yaml"],"description":"Format for validation (auto-detected from extension if omitted)"}},"required":["path","content"]}},
        {"name":"list_tasks","description":"List Task nodes recorded in the CRDT. Each prompt execution creates one Task. Supports optional filtering by status (active/done/failed/blocked) and context_id (session).",
         "input_schema":{"type":"object","properties":{"limit":{"type":"integer","description":"Max tasks to return (default 20, max 100)"},"status":{"type":"string","enum":["active","done","failed","blocked","cancelled","deferred","pending"],"description":"Filter by task status"},"context_id":{"type":"string","description":"Filter to tasks from a specific session URN"}},"required":[]}},
        {"name":"task_status","description":"Get full details of a single Task including its title, status, timestamps, and all associated TaskEvents (created, status_changed).",
         "input_schema":{"type":"object","properties":{"task_id":{"type":"string","description":"Task URN (urn:refarm:task:v1:...)"}},"required":["task_id"]}}
    ])
}

pub(crate) fn tools_openai() -> serde_json::Value {
    serde_json::json!([
        {"type":"function","function":{"name":"read_file","description":"Read file at absolute path. Pageable: use limit and offset for large files.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"limit":{"type":"integer"},"offset":{"type":"integer"}},"required":["path"]}}},
        {"type":"function","function":{"name":"write_file","description":"Write UTF-8 content to file atomically.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}},
        {"type":"function","function":{"name":"edit_file","description":"Apply one or more targeted string replacements to a file. Each edit replaces old_str with new_str; fails if old_str is not found or appears more than once.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"edits":{"type":"array","items":{"type":"object","properties":{"old_str":{"type":"string"},"new_str":{"type":"string"}},"required":["old_str","new_str"]}}},"required":["path","edits"]}}},
        {"type":"function","function":{"name":"apply_patch","description":"Apply a unified diff to a file in one shot (the large-refactor complement to edit_file). Applied atomically; fails if the diff context does not match the current file. Prefer this when changing several hunks of one file.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"patch":{"type":"string"}},"required":["path","patch"]}}},
        {"type":"function","function":{"name":"list_dir","description":"List files and directories at a path.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
        {"type":"function","function":{"name":"search_files","description":"Search for a pattern in files (grep). Returns matching lines with file:line prefix.",
         "parameters":{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string"},"glob":{"type":"string"},"max_results":{"type":"integer"}},"required":["pattern","path"]}}},
        {"type":"function","function":{"name":"glob","description":"Find files BY NAME matching a glob (e.g. *.rs) recursively under a path — the locate-files complement to search_files (content) and list_dir (one directory).",
         "parameters":{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string"},"max_results":{"type":"integer"}},"required":["pattern"]}}},
        {"type":"function","function":{"name":"bash","description":"Run command via structured argv (no shell expansion).",
         "parameters":{"type":"object","properties":{"argv":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"},"timeout_ms":{"type":"integer"}},"required":["argv"]}}},
        {"type":"function","function":{"name":"read_structured","description":"Parse a structured file (JSON, TOML, YAML) with automatic pagination.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"format":{"type":"string","enum":["json","toml","yaml"]},"page_size":{"type":"integer"},"page_offset":{"type":"integer"}},"required":["path"]}}},
        {"type":"function","function":{"name":"write_structured","description":"Validate and write structured content (JSON, TOML, YAML) atomically. Rejects invalid syntax before touching the file.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"},"format":{"type":"string","enum":["json","toml","yaml"]}},"required":["path","content"]}}},
        {"type":"function","function":{"name":"list_tasks","description":"List Task nodes from the CRDT. Each prompt creates one Task. Filter by status or context_id.",
         "parameters":{"type":"object","properties":{"limit":{"type":"integer"},"status":{"type":"string","enum":["active","done","failed","blocked","cancelled","deferred","pending"]},"context_id":{"type":"string"}}}}},
        {"type":"function","function":{"name":"task_status","description":"Get full details of a single Task by its URN, including all TaskEvents.",
         "parameters":{"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]}}}
    ])
}
