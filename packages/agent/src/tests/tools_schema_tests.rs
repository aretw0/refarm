use super::*;

#[test]
fn tools_anthropic_includes_search_files() {
    let tools = tools_anthropic();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert!(
        names.contains(&"search_files"),
        "search_files must be in anthropic tools: {names:?}"
    );
}

#[test]
fn tools_openai_includes_search_files() {
    let tools = tools_openai();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["function"]["name"].as_str())
        .collect();
    assert!(
        names.contains(&"search_files"),
        "search_files must be in openai tools: {names:?}"
    );
}

#[test]
fn tools_anthropic_includes_list_dir() {
    let tools = tools_anthropic();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert!(
        names.contains(&"list_dir"),
        "list_dir must be in anthropic tools: {names:?}"
    );
}

#[test]
fn tools_openai_includes_list_dir() {
    let tools = tools_openai();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["function"]["name"].as_str())
        .collect();
    assert!(
        names.contains(&"list_dir"),
        "list_dir must be in openai tools: {names:?}"
    );
}

#[test]
fn tools_anthropic_includes_edit_file_with_edits_schema() {
    let tools = tools_anthropic();
    let edit = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "edit_file")
        .expect("edit_file must be in anthropic tools");
    let props = &edit["input_schema"]["properties"];
    assert!(props.get("path").is_some(), "schema must have path");
    assert!(
        props.get("edits").is_some(),
        "schema must have edits array, not diff"
    );
    assert!(
        props.get("diff").is_none(),
        "unified diff schema must be removed"
    );
}

#[test]
fn tools_openai_includes_edit_file_with_edits_schema() {
    let tools = tools_openai();
    let edit = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["function"]["name"] == "edit_file")
        .expect("edit_file must be in openai tools");
    let props = &edit["function"]["parameters"]["properties"];
    assert!(
        props.get("edits").is_some(),
        "schema must have edits array, not diff"
    );
    assert!(
        props.get("diff").is_none(),
        "unified diff schema must be removed"
    );
}

#[test]
fn tools_anthropic_includes_apply_patch_with_patch_schema() {
    let tools = tools_anthropic();
    let patch = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "apply_patch")
        .expect("apply_patch must be in anthropic tools");
    let props = &patch["input_schema"]["properties"];
    assert!(props.get("path").is_some(), "schema must have path");
    assert!(props.get("patch").is_some(), "schema must have patch (unified diff)");
}

#[test]
fn tools_openai_includes_apply_patch() {
    let tools = tools_openai();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["function"]["name"].as_str())
        .collect();
    assert!(names.contains(&"apply_patch"), "apply_patch in openai tools: {names:?}");
}

#[test]
fn tools_anthropic_includes_glob_with_pattern_schema() {
    let tools = tools_anthropic();
    let glob = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "glob")
        .expect("glob must be in anthropic tools");
    let props = &glob["input_schema"]["properties"];
    assert!(props.get("pattern").is_some(), "glob schema must have pattern");
    // glob finds by NAME; it must not require the content-search `pattern`+`path` pair.
    let required = glob["input_schema"]["required"].as_array().unwrap();
    assert!(required.iter().any(|r| r == "pattern"));
    assert!(!required.iter().any(|r| r == "path"), "path is optional for glob");
}

#[test]
fn tools_openai_includes_glob() {
    let tools = tools_openai();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["function"]["name"].as_str())
        .collect();
    assert!(names.contains(&"glob"), "glob in openai tools: {names:?}");
}
