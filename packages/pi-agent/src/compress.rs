/// Strip ANSI escape sequences (CSI: ESC [ ... letter) so dedup can match
/// lines that differ only by color codes. No external dep required.
pub(crate) fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            for nc in chars.by_ref() {
                if ('@'..='~').contains(&nc) {
                    break;
                } // final byte ends the sequence
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Collapse consecutive identical lines that repeat ≥ 2 times into one entry
/// annotated `[×N]`. Inspired by squeez (claudioemmanuel/squeez).
pub(crate) fn dedup_lines(lines: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let cur = lines[i];
        let mut run = 1;
        while i + run < lines.len() && lines[i + run] == cur {
            run += 1;
        }
        if run >= 2 {
            out.push(format!("{cur} [×{run}]"));
        } else {
            out.push(cur.to_string());
        }
        i += run;
    }
    out
}

/// Pipeline: strip ANSI → dedup repeated lines → truncate to LLM_TOOL_OUTPUT_MAX_LINES.
/// Inspired by squeez (claudioemmanuel/squeez). Default: unlimited, fully opt-in.
/// The truncation header tells the LLM how much was hidden so it can request more.
pub(crate) fn compress_tool_output(output: &str) -> String {
    let max_lines = std::env::var("LLM_TOOL_OUTPUT_MAX_LINES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(usize::MAX);
    let stripped = strip_ansi(output);
    let raw_lines: Vec<&str> = stripped.lines().collect();
    let lines = dedup_lines(&raw_lines);
    // Fast path: nothing changed and under limit
    if lines.len() == raw_lines.len() && stripped == output && lines.len() <= max_lines {
        return output.to_owned();
    }
    if lines.len() <= max_lines {
        return lines.join("\n");
    }
    format!(
        "[truncated: {} lines → first {} shown]\n{}",
        lines.len(),
        max_lines,
        lines[..max_lines].join("\n")
    )
}
