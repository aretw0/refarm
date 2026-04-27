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

