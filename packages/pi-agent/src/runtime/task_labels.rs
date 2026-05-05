/// Pure helpers for task title and status classification.
///
/// Kept in a separate, non-wasm32-gated module so they can be
/// unit-tested on the host without the tractor_bridge WASI import.

pub(super) fn title_from_prompt(prompt: &str) -> String {
    let first_line = prompt.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return "Agent prompt".to_string();
    }
    let mut title: String = first_line.chars().take(120).collect();
    if first_line.chars().count() > 120 {
        title.push('…');
    }
    title
}

pub(super) fn status_from_content(content: &str) -> &'static str {
    if content.starts_with("[budget]") {
        "blocked"
    } else if content.starts_with("[pi-agent erro]") || content.starts_with("[pi-agent stub]") {
        "failed"
    } else {
        "done"
    }
}

/// Format recent task nodes as a brief system-prompt memory block.
///
/// Returns `None` when `limit` is 0 or all tasks lack a title.
/// The returned string is intended to be appended to the system prompt
/// so the agent has cross-session context without an explicit tool call.
pub(super) fn format_task_context(tasks: &[serde_json::Value], limit: usize) -> Option<String> {
    if limit == 0 || tasks.is_empty() {
        return None;
    }
    let lines: Vec<String> = tasks
        .iter()
        .take(limit)
        .filter_map(|t| {
            let title = t["title"].as_str()?;
            let status = t["status"].as_str().unwrap_or("?");
            Some(format!("- [{status}] {title}"))
        })
        .collect();
    if lines.is_empty() {
        return None;
    }
    Some(format!("\n\nRecent work:\n{}", lines.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::{format_task_context, status_from_content, title_from_prompt};

    #[test]
    fn title_uses_first_line() {
        assert_eq!(title_from_prompt("hello\nsecond line"), "hello");
    }

    #[test]
    fn title_trims_whitespace() {
        assert_eq!(title_from_prompt("  spaced  \nmore"), "spaced");
    }

    #[test]
    fn title_empty_prompt_returns_default() {
        assert_eq!(title_from_prompt(""), "Agent prompt");
        assert_eq!(title_from_prompt("\n\n"), "Agent prompt");
    }

    #[test]
    fn title_truncates_at_120_chars_with_ellipsis() {
        let long: String = "a".repeat(130);
        let title = title_from_prompt(&long);
        assert_eq!(title.chars().count(), 121); // 120 chars + '…'
        assert!(title.ends_with('…'));
    }

    #[test]
    fn title_exact_120_chars_no_ellipsis() {
        let exact: String = "b".repeat(120);
        let title = title_from_prompt(&exact);
        assert_eq!(title, exact);
        assert!(!title.ends_with('…'));
    }

    #[test]
    fn status_budget_prefix_is_blocked() {
        assert_eq!(status_from_content("[budget] limit reached"), "blocked");
    }

    #[test]
    fn status_error_prefix_is_failed() {
        assert_eq!(status_from_content("[pi-agent erro] something"), "failed");
    }

    #[test]
    fn status_stub_prefix_is_failed() {
        assert_eq!(status_from_content("[pi-agent stub] noop"), "failed");
    }

    #[test]
    fn status_normal_content_is_done() {
        assert_eq!(status_from_content("here is your answer"), "done");
        assert_eq!(status_from_content(""), "done");
    }

    #[test]
    fn task_context_zero_limit_returns_none() {
        let task = serde_json::json!({ "title": "something", "status": "done" });
        assert!(format_task_context(&[task], 0).is_none());
    }

    #[test]
    fn task_context_empty_list_returns_none() {
        assert!(format_task_context(&[], 5).is_none());
    }

    #[test]
    fn task_context_formats_status_and_title() {
        let tasks = vec![
            serde_json::json!({ "title": "implement fork", "status": "done" }),
            serde_json::json!({ "title": "add task endpoint", "status": "done" }),
        ];
        let ctx = format_task_context(&tasks, 5).unwrap();
        assert!(ctx.contains("Recent work:"), "must include header");
        assert!(ctx.contains("[done] implement fork"));
        assert!(ctx.contains("[done] add task endpoint"));
    }

    #[test]
    fn task_context_caps_at_limit() {
        let tasks: Vec<_> = (0..10)
            .map(|i| serde_json::json!({ "title": format!("task {i}"), "status": "done" }))
            .collect();
        let ctx = format_task_context(&tasks, 3).unwrap();
        let bullet_lines: Vec<_> = ctx.lines().filter(|l| l.starts_with("- ")).collect();
        assert_eq!(bullet_lines.len(), 3);
    }

    #[test]
    fn task_context_skips_tasks_without_title() {
        let tasks = vec![
            serde_json::json!({ "status": "done" }),          // no title — skip
            serde_json::json!({ "title": "valid", "status": "active" }),
        ];
        let ctx = format_task_context(&tasks, 5).unwrap();
        let bullet_lines: Vec<_> = ctx.lines().filter(|l| l.starts_with("- ")).collect();
        assert_eq!(bullet_lines.len(), 1);
        assert!(ctx.contains("[active] valid"));
    }

    #[test]
    fn task_context_all_titleless_returns_none() {
        let tasks = vec![
            serde_json::json!({ "status": "done" }),
            serde_json::json!({ "status": "active" }),
        ];
        assert!(format_task_context(&tasks, 5).is_none());
    }
}
