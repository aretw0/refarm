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

#[cfg(test)]
mod tests {
    use super::{status_from_content, title_from_prompt};

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
}
