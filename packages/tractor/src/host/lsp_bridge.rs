use std::collections::HashSet;
use std::io::{Read as _, Write as _};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::host::plugin_host::plugin::host::code_ops::{
    CodeReference, RenameResult, SymbolLocation,
};

pub(crate) const DEFAULT_RUST_LSP_CMD: &str = "rust-analyzer";
const LSP_CMD_ENV: &str = "REFACTOR_LSP_CMD";
const LEGACY_LSP_CMD_ENV: &str = "REFACTOR_LSP_RUST_ANALYZER_CMD";
const LSP_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// How often to re-ask while the server's analysis is still settling, and how long to keep
/// trying. See `settle_document_analysis` for why polling is the portable option.
const LSP_SETTLE_POLL: Duration = Duration::from_millis(400);
const LSP_SETTLE_BUDGET: Duration = Duration::from_secs(8);
/// Stability is not completion. While the project loads, the server answers the SAME partial
/// result every time, so consecutive replies agree long before the analysis is done. Measured
/// on this workspace, the answer was still partial at 800ms and complete at 1500ms — so no
/// agreement is trusted before this floor has passed.
const LSP_SETTLE_FLOOR: Duration = Duration::from_millis(1_600);

static LSP_SESSION: OnceLock<Mutex<Option<LspServerProcess>>> = OnceLock::new();

pub(crate) struct LspBridge {
    lsp_cmd: String,
}

/// Owns one LSP server subprocess.
///
/// Lifecycle contract:
/// - `start` creates the child with piped stdin/stdout so a future JSON-RPC
///   layer can speak LSP without changing process ownership.
/// - callers store it behind a process-wide mutex and reuse it across code-op
///   calls instead of spawning one language server per request.
/// - `stop` is idempotent and is also called from `Drop`, so a partially
///   initialized bridge cannot leak a long-lived LSP server process.
struct LspServerProcess {
    command: String,
    child: Child,
    stdin: ChildStdin,
    messages: Receiver<Result<serde_json::Value, String>>,
    reader: Option<JoinHandle<()>>,
    initialized: bool,
    /// Documents already announced with `textDocument/didOpen`, by URI. A language server
    /// answers about its OWN copy of a document, not about the file on disk, so a query on a
    /// document it was never told about is answered against nothing — and a server like
    /// typescript-language-server will still answer, resolving the position against an empty
    /// buffer and returning references to whatever it finds there. Re-opening on every call
    /// would discard the server's analysis, so each document is announced once per session.
    opened: HashSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LspTextEdit {
    file: String,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
    new_text: String,
}

impl LspServerProcess {
    fn start(program: &str, args: &[&str]) -> Result<Self, String> {
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("lsp start({program}): {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "lsp start: child stdin was not piped".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "lsp start: child stdout was not piped".to_string())?;
        let (tx, messages) = mpsc::channel();
        let reader = std::thread::spawn(move || read_lsp_stdout(stdout, tx));

        Ok(Self {
            command: program.to_string(),
            child,
            stdin,
            messages,
            reader: Some(reader),
            initialized: false,
            opened: HashSet::new(),
        })
    }

    fn start_command(command: &str) -> Result<Self, String> {
        let (program, args) = split_lsp_command(command)?;
        let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        let mut process = Self::start(&program, &arg_refs)?;
        process.command = command.to_string();
        Ok(process)
    }

    fn id(&self) -> u32 {
        self.child.id()
    }

    fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn stop(&mut self) {
        if self.is_running() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }

    fn send(&mut self, message: &serde_json::Value) -> Result<(), String> {
        self.stdin
            .write_all(&encode_lsp_message(message))
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("lsp write: {e}"))
    }

    fn request_response(
        &mut self,
        request: &serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value, String> {
        let id = request
            .get("id")
            .cloned()
            .ok_or_else(|| "lsp request missing id".to_string())?;
        self.send(request)?;

        loop {
            match self.messages.recv_timeout(timeout) {
                Ok(Ok(message)) if message.get("id") == Some(&id) => return Ok(message),
                Ok(Ok(_notification_or_other_response)) => continue,
                Ok(Err(e)) => return Err(e),
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!("lsp request timed out waiting for id {id}"));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("lsp reader disconnected".to_string());
                }
            }
        }
    }
}

impl Drop for LspServerProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

impl LspBridge {
    /// Build a bridge reading the LSP command from env. Now test-only: production
    /// resolves the command ONCE at boot into HostEffectPolicy and constructs via
    /// `with_cmd`. Retained so the lsp_bridge unit tests can still exercise the
    /// env-parsing path directly.
    #[cfg(test)]
    pub(crate) fn from_env() -> Self {
        let lsp_cmd = configured_lsp_command();

        Self { lsp_cmd }
    }

    /// Build a bridge from an already-resolved LSP command (from HostEffectPolicy,
    /// resolved once at boot) so a code-op reads config, not process env.
    pub(crate) fn with_cmd(lsp_cmd: impl Into<String>) -> Self {
        Self {
            lsp_cmd: lsp_cmd.into(),
        }
    }

    pub(crate) fn rename_symbol(
        &self,
        loc: &SymbolLocation,
        new_name: &str,
    ) -> Result<RenameResult, String> {
        let mut slot = Self::lock_session()?;
        Self::ensure_lsp_session_locked(&mut slot, &self.lsp_cmd)?;
        let session = slot
            .as_mut()
            .ok_or_else(|| "lsp session unavailable after start".to_string())?;

        ensure_initialized(session)?;
        ensure_document_open(session, &loc.file)?;
        settle_document_analysis(session, loc)?;
        let response =
            session.request_response(&rename_request(3, loc, new_name), LSP_REQUEST_TIMEOUT)?;
        let edits = parse_rename_response(&response)?;
        apply_lsp_text_edits(&edits)
    }

    pub(crate) fn find_references(
        &self,
        loc: &SymbolLocation,
    ) -> Result<Vec<CodeReference>, String> {
        let mut slot = Self::lock_session()?;
        Self::ensure_lsp_session_locked(&mut slot, &self.lsp_cmd)?;
        let session = slot
            .as_mut()
            .ok_or_else(|| "lsp session unavailable after start".to_string())?;

        ensure_initialized(session)?;
        ensure_document_open(session, &loc.file)?;
        settle_document_analysis(session, loc)?;
        let response =
            session.request_response(&references_request(2, loc), LSP_REQUEST_TIMEOUT)?;
        parse_references_response(&response)
    }

    /// Move a top-level item at `loc` to `target_file`. Like rename, the server returns a
    /// WorkspaceEdit (changes/documentChanges) — so the response is parsed and applied by
    /// the SAME machinery as rename. Move is server-dependent; a server that doesn't
    /// support the request replies with an error (or an empty edit), surfaced as such.
    pub(crate) fn move_symbol(
        &self,
        loc: &SymbolLocation,
        target_file: &str,
    ) -> Result<RenameResult, String> {
        let mut slot = Self::lock_session()?;
        Self::ensure_lsp_session_locked(&mut slot, &self.lsp_cmd)?;
        let session = slot
            .as_mut()
            .ok_or_else(|| "lsp session unavailable after start".to_string())?;

        ensure_initialized(session)?;
        ensure_document_open(session, &loc.file)?;
        settle_document_analysis(session, loc)?;
        let response =
            session.request_response(&move_request(4, loc, target_file), LSP_REQUEST_TIMEOUT)?;
        // A move returns a WorkspaceEdit exactly like rename — reuse the parse + apply.
        let edits = parse_rename_response(&response)?;
        apply_lsp_text_edits(&edits)
    }

    fn session_slot() -> &'static Mutex<Option<LspServerProcess>> {
        LSP_SESSION.get_or_init(|| Mutex::new(None))
    }

    fn lock_session() -> Result<MutexGuard<'static, Option<LspServerProcess>>, String> {
        Self::session_slot()
            .lock()
            .map_err(|_| "lsp session lock poisoned".to_string())
    }

    #[cfg(test)]
    fn ensure_lsp_session(&self) -> Result<u32, String> {
        let mut slot = Self::lock_session()?;
        Self::ensure_lsp_session_locked(&mut slot, &self.lsp_cmd)
    }

    fn ensure_lsp_session_locked(
        slot: &mut Option<LspServerProcess>,
        lsp_cmd: &str,
    ) -> Result<u32, String> {
        if let Some(session) = slot.as_mut() {
            if session.command == lsp_cmd && session.is_running() {
                return Ok(session.id());
            }
            session.stop();
            *slot = None;
        }

        let session = LspServerProcess::start_command(lsp_cmd)?;
        let pid = session.id();
        *slot = Some(session);
        Ok(pid)
    }

    #[cfg(test)]
    pub(crate) fn stop_lsp_session() -> Result<(), String> {
        let mut slot = Self::lock_session()?;
        if let Some(mut session) = slot.take() {
            session.stop();
        }
        Ok(())
    }
}

fn encode_lsp_message(message: &serde_json::Value) -> Vec<u8> {
    let body = message.to_string();
    format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
}

fn drain_lsp_messages(buffer: &mut Vec<u8>) -> Result<Vec<serde_json::Value>, String> {
    let mut messages = Vec::new();

    while let Some(header_end) = find_header_end(buffer) {
        let header = std::str::from_utf8(&buffer[..header_end])
            .map_err(|e| format!("lsp header utf8: {e}"))?;
        let content_len = content_length(header)?;
        let body_start = header_end + 4;
        let frame_end = body_start + content_len;
        if buffer.len() < frame_end {
            break;
        }

        let body = buffer[body_start..frame_end].to_vec();
        buffer.drain(..frame_end);
        let value = serde_json::from_slice(&body).map_err(|e| format!("lsp json: {e}"))?;
        messages.push(value);
    }

    Ok(messages)
}

fn read_lsp_stdout(
    mut stdout: std::process::ChildStdout,
    tx: mpsc::Sender<Result<serde_json::Value, String>>,
) {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];

    loop {
        match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buffer.extend_from_slice(&chunk[..n]);
                match drain_lsp_messages(&mut buffer) {
                    Ok(messages) => {
                        for message in messages {
                            if tx.send(Ok(message)).is_err() {
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e));
                        return;
                    }
                }
            }
            Err(e) => {
                let _ = tx.send(Err(format!("lsp stdout read: {e}")));
                return;
            }
        }
    }
}

fn ensure_initialized(session: &mut LspServerProcess) -> Result<(), String> {
    if session.initialized {
        return Ok(());
    }

    let root_uri = workspace_root_uri();
    let response = session.request_response(&initialize_request(&root_uri), LSP_REQUEST_TIMEOUT)?;
    if let Some(error) = response.get("error") {
        return Err(format!("lsp initialize error: {error}"));
    }
    session.send(&initialized_notification())?;
    session.initialized = true;
    Ok(())
}

fn initialized_notification() -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|w| w == b"\r\n\r\n")
}

fn content_length(header: &str) -> Result<usize, String> {
    header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim())
        })
        .ok_or_else(|| "lsp frame missing Content-Length".to_string())?
        .parse::<usize>()
        .map_err(|e| format!("lsp Content-Length parse: {e}"))
}

fn initialize_request(root_uri: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "processId": std::process::id(),
            "rootUri": root_uri,
            "capabilities": {}
        }
    })
}

fn workspace_root_uri() -> String {
    file_uri(
        std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .to_string_lossy()
            .as_ref(),
    )
}

/// The LSP `languageId` for a path. Servers use it to pick the analyzer for the document;
/// getting it wrong (or omitting it) makes a server treat source as plain text.
fn language_id_for(path: &str) -> &'static str {
    match std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
    {
        Some("ts") => "typescript",
        Some("tsx") => "typescriptreact",
        Some("mts") | Some("cts") => "typescript",
        Some("js") | Some("mjs") | Some("cjs") => "javascript",
        Some("jsx") => "javascriptreact",
        Some("rs") => "rust",
        Some("py") => "python",
        Some("go") => "go",
        _ => "plaintext",
    }
}

fn did_open_notification(path: &str, text: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": {
                "uri": file_uri(path),
                "languageId": language_id_for(path),
                "version": 1,
                "text": text
            }
        }
    })
}

/// Announce a document to the server before asking anything about it — the step that makes a
/// code op answer about the file the caller meant. Idempotent per session.
fn ensure_document_open(session: &mut LspServerProcess, path: &str) -> Result<(), String> {
    let uri = file_uri(path);
    if session.opened.contains(&uri) {
        return Ok(());
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("lsp didOpen: cannot read {path}: {e}"))?;
    session.send(&did_open_notification(path, &text))?;
    session.opened.insert(uri);
    Ok(())
}

/// Wait until the server's answer for `loc` stops growing.
///
/// A language server answers a positional query with WHAT IT KNOWS SO FAR, and says nothing
/// about the analysis still loading. Ask right after `didOpen` and the reply carries only the
/// hits inside the file just opened — a plausible, complete-looking, WRONG answer. Measured
/// against typescript-language-server on this workspace: the same query returns 1 reference at
/// 0ms, 200ms and 800ms, and 2 (the cross-file one included) at 1500ms.
///
/// There is no portable "indexing finished" signal to wait on — with baseline capabilities the
/// server emits only `window/logMessage`. So the settle is measured, not announced: re-ask a
/// READ-ONLY query until two consecutive answers agree, bounded by a budget. Rename and move
/// settle through the same read-only probe, never by repeating the mutating request.
///
/// Runs once per document, right after it is opened; a warm session pays nothing.
fn settle_document_analysis(
    session: &mut LspServerProcess,
    loc: &SymbolLocation,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let deadline = started + LSP_SETTLE_BUDGET;
    let mut previous: Option<usize> = None;
    let mut probe_id = 100u64;
    while std::time::Instant::now() < deadline {
        probe_id += 1;
        let response =
            session.request_response(&references_request(probe_id, loc), LSP_REQUEST_TIMEOUT)?;
        let count = parse_references_response(&response)
            .map(|refs| refs.len())
            .unwrap_or(0);
        if previous == Some(count) && started.elapsed() >= LSP_SETTLE_FLOOR {
            return Ok(());
        }
        previous = Some(count);
        std::thread::sleep(LSP_SETTLE_POLL);
    }
    // Budget spent: proceed with whatever the server has. The caller gets a real answer, just
    // not a guaranteed-complete one — better than blocking a code op indefinitely.
    Ok(())
}

fn references_request(id: u64, loc: &SymbolLocation) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "textDocument/references",
        "params": {
            "textDocument": { "uri": file_uri(&loc.file) },
            "position": lsp_position(loc),
            "context": { "includeDeclaration": true }
        }
    })
}

fn rename_request(id: u64, loc: &SymbolLocation, new_name: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "textDocument/rename",
        "params": {
            "textDocument": { "uri": file_uri(&loc.file) },
            "position": lsp_position(loc),
            "newName": new_name
        }
    })
}

/// The move request. LSP has no standard `textDocument/move`; servers expose it via an
/// experimental method or a command. We use `experimental/moveSymbol` with the symbol
/// position + the destination `targetUri`; a server that implements it returns a
/// WorkspaceEdit (parsed like rename). A server that does not returns an error/empty.
fn move_request(id: u64, loc: &SymbolLocation, target_file: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "experimental/moveSymbol",
        "params": {
            "textDocument": { "uri": file_uri(&loc.file) },
            "position": lsp_position(loc),
            "targetUri": file_uri(target_file)
        }
    })
}

fn parse_rename_response(response: &serde_json::Value) -> Result<Vec<LspTextEdit>, String> {
    if let Some(error) = response.get("error") {
        return Err(format!("lsp rename error: {error}"));
    }

    let Some(result) = response.get("result") else {
        return Ok(Vec::new());
    };

    let mut edits = Vec::new();
    if let Some(changes) = result.get("changes").and_then(|v| v.as_object()) {
        for (uri, values) in changes {
            let Some(values) = values.as_array() else {
                return Err(format!("lsp rename changes for {uri} must be an array"));
            };
            for value in values {
                edits.push(text_edit_from_lsp_value(&file_uri_to_path(uri), value)?);
            }
        }
    }

    if let Some(document_changes) = result.get("documentChanges").and_then(|v| v.as_array()) {
        for document_change in document_changes {
            let Some(text_document) = document_change.get("textDocument") else {
                continue;
            };
            let Some(uri) = text_document.get("uri").and_then(|v| v.as_str()) else {
                return Err("lsp documentChange missing textDocument.uri".to_string());
            };
            let Some(values) = document_change.get("edits").and_then(|v| v.as_array()) else {
                return Err(format!(
                    "lsp documentChange edits for {uri} must be an array"
                ));
            };
            for value in values {
                edits.push(text_edit_from_lsp_value(&file_uri_to_path(uri), value)?);
            }
        }
    }

    Ok(edits)
}

fn text_edit_from_lsp_value(file: &str, value: &serde_json::Value) -> Result<LspTextEdit, String> {
    let range = value
        .get("range")
        .ok_or_else(|| "lsp text edit missing range".to_string())?;
    let start = range
        .get("start")
        .ok_or_else(|| "lsp text edit missing range.start".to_string())?;
    let end = range
        .get("end")
        .ok_or_else(|| "lsp text edit missing range.end".to_string())?;
    let new_text = value
        .get("newText")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "lsp text edit missing newText".to_string())?;

    Ok(LspTextEdit {
        file: file.to_string(),
        start_line: lsp_u32(start, "line")?,
        start_character: lsp_u32(start, "character")?,
        end_line: lsp_u32(end, "line")?,
        end_character: lsp_u32(end, "character")?,
        new_text: new_text.to_string(),
    })
}

fn lsp_u32(value: &serde_json::Value, field: &str) -> Result<u32, String> {
    value
        .get(field)
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok())
        .ok_or_else(|| format!("lsp value missing u32 field {field}"))
}

fn apply_lsp_text_edits(edits: &[LspTextEdit]) -> Result<RenameResult, String> {
    let mut by_file = std::collections::BTreeMap::<String, Vec<LspTextEdit>>::new();
    for edit in edits {
        by_file
            .entry(edit.file.clone())
            .or_default()
            .push(edit.clone());
    }

    let files_changed = by_file.len() as u32;
    let edits_applied = edits.len() as u32;
    for (file, mut file_edits) in by_file {
        let original =
            std::fs::read_to_string(&file).map_err(|e| format!("lsp rename/read({file}): {e}"))?;
        file_edits.sort_by(|a, b| {
            (b.start_line, b.start_character, b.end_line, b.end_character).cmp(&(
                a.start_line,
                a.start_character,
                a.end_line,
                a.end_character,
            ))
        });
        let mut updated = original;
        for edit in file_edits {
            apply_lsp_text_edit(&mut updated, &edit)?;
        }
        std::fs::write(&file, updated).map_err(|e| format!("lsp rename/write({file}): {e}"))?;
    }

    Ok(RenameResult {
        files_changed,
        edits_applied,
    })
}

fn apply_lsp_text_edit(content: &mut String, edit: &LspTextEdit) -> Result<(), String> {
    let start = byte_offset_for_lsp_position(content, edit.start_line, edit.start_character)?;
    let end = byte_offset_for_lsp_position(content, edit.end_line, edit.end_character)?;
    if start > end {
        return Err("lsp text edit start is after end".to_string());
    }
    content.replace_range(start..end, &edit.new_text);
    Ok(())
}

fn byte_offset_for_lsp_position(content: &str, line: u32, character: u32) -> Result<usize, String> {
    let mut line_start: usize = 0;
    for (idx, current_line) in content.split_inclusive('\n').enumerate() {
        if idx == line as usize {
            return line_start
                .checked_add(byte_offset_in_line(current_line, character)?)
                .ok_or_else(|| "lsp position offset overflow".to_string());
        }
        line_start += current_line.len();
    }

    if line as usize == content.lines().count() && character == 0 {
        return Ok(content.len());
    }

    Err(format!("lsp position line out of range: {line}"))
}

fn byte_offset_in_line(line: &str, character: u32) -> Result<usize, String> {
    let without_newline = line.trim_end_matches(['\r', '\n']);
    // LSP positions count UTF-16 CODE UNITS (the spec's default position encoding), not Unicode scalars:
    // a non-BMP char (e.g. an emoji, or a supplementary-plane CJK glyph) is TWO units. Walk the line
    // accumulating each char's utf-16 length; the byte offset is where the running unit count reaches
    // `character`. A `character` that lands inside a surrogate pair, or past the line, is out of range.
    let target = character as usize;
    let mut units = 0usize;
    for (idx, ch) in without_newline.char_indices() {
        if units == target {
            return Ok(idx);
        }
        units += ch.len_utf16();
    }
    // `character` at the end of the line maps to the line's byte length (LSP allows an end-of-line column).
    if units == target {
        return Ok(without_newline.len());
    }
    Err(format!("lsp position character out of range: {character}"))
}

fn parse_references_response(response: &serde_json::Value) -> Result<Vec<CodeReference>, String> {
    if let Some(error) = response.get("error") {
        return Err(format!("lsp references error: {error}"));
    }

    let Some(items) = response.get("result").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };

    items.iter().map(code_reference_from_lsp_location).collect()
}

fn code_reference_from_lsp_location(value: &serde_json::Value) -> Result<CodeReference, String> {
    let uri = value
        .get("uri")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "lsp location missing uri".to_string())?;
    let start = value
        .get("range")
        .and_then(|v| v.get("start"))
        .ok_or_else(|| "lsp location missing range.start".to_string())?;
    let line = start
        .get("line")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "lsp location missing start.line".to_string())?;
    let character = start
        .get("character")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "lsp location missing start.character".to_string())?;

    Ok(CodeReference {
        file: file_uri_to_path(uri),
        line: line.saturating_add(1) as u32,
        column: character.saturating_add(1) as u32,
        kind: "reference".to_string(),
    })
}

fn file_uri_to_path(uri: &str) -> String {
    uri.strip_prefix("file://").unwrap_or(uri).to_string()
}

fn lsp_position(loc: &SymbolLocation) -> serde_json::Value {
    serde_json::json!({
        "line": loc.line.saturating_sub(1),
        "character": loc.column.saturating_sub(1)
    })
}

fn file_uri(path: &str) -> String {
    let path = std::path::Path::new(path);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join(path)
    };
    format!("file://{}", absolute.to_string_lossy())
}

fn split_lsp_command(command: &str) -> Result<(String, Vec<String>), String> {
    let mut parts = command.split_whitespace();
    let program = parts
        .next()
        .ok_or_else(|| "lsp command must not be empty".to_string())?
        .to_string();
    let args = parts.map(str::to_string).collect();
    Ok((program, args))
}

/// Resolve the LSP command from env (REFACTOR_LSP_CMD, legacy fallback). Called
/// ONCE at boot via `HostEffectPolicy::from_env`; the resolved value then rides on
/// the policy and is read per code-op via `LspBridge::with_cmd`, not from env.
pub(crate) fn configured_lsp_command() -> String {
    std::env::var(LSP_CMD_ENV)
        .or_else(|_| std::env::var(LEGACY_LSP_CMD_ENV))
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_RUST_LSP_CMD.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::env_lock;

    #[test]
    fn byte_offset_counts_utf16_code_units_not_scalars() {
        // ASCII: an LSP character == the byte offset.
        assert_eq!(byte_offset_in_line("let x = 1;", 4), Ok(4));
        // A non-BMP char (😀 = U+1F600) is TWO UTF-16 units and FOUR UTF-8 bytes. In "a😀b":
        //   'a' at utf16 0 / byte 0; '😀' at utf16 1 / byte 1; 'b' at utf16 3 / byte 5.
        assert_eq!(byte_offset_in_line("a😀b", 0), Ok(0));
        assert_eq!(byte_offset_in_line("a😀b", 1), Ok(1)); // '😀' starts here
        assert_eq!(byte_offset_in_line("a😀b", 3), Ok(5)); // 'b' — utf16 3 (the emoji added 2 units)
        // A position INSIDE the surrogate pair (utf16 2) has no char boundary → out of range.
        assert!(byte_offset_in_line("a😀b", 2).is_err());
        // The end-of-line column maps to the byte length; past it is out of range.
        assert_eq!(byte_offset_in_line("a😀b", 4), Ok("a😀b".len()));
        assert!(byte_offset_in_line("a😀b", 5).is_err());
        // A trailing newline is trimmed before mapping.
        assert_eq!(byte_offset_in_line("ab\n", 2), Ok(2));
    }

    #[test]
    fn bridge_defaults_command() {
        let _guard = env_lock();
        std::env::remove_var(LSP_CMD_ENV);
        std::env::remove_var(LEGACY_LSP_CMD_ENV);
        let bridge = LspBridge::from_env();
        assert_eq!(bridge.lsp_cmd, "rust-analyzer");
    }

    #[test]
    fn bridge_honors_env_override() {
        let _guard = env_lock();
        std::env::set_var(LSP_CMD_ENV, "custom-lsp --stdio");
        let bridge = LspBridge::from_env();
        std::env::remove_var(LSP_CMD_ENV);
        assert_eq!(bridge.lsp_cmd, "custom-lsp --stdio");
    }

    #[test]
    fn bridge_honors_legacy_rust_analyzer_env_override() {
        let _guard = env_lock();
        std::env::remove_var(LSP_CMD_ENV);
        std::env::set_var(LEGACY_LSP_CMD_ENV, "legacy-ra");
        let bridge = LspBridge::from_env();
        std::env::remove_var(LEGACY_LSP_CMD_ENV);
        assert_eq!(bridge.lsp_cmd, "legacy-ra");
    }

    #[test]
    fn lsp_process_stop_is_idempotent() {
        let mut process = LspServerProcess::start("sleep", &["10"]).expect("sleep starts");
        assert!(process.is_running());
        process.stop();
        process.stop();
        assert!(!process.is_running());
    }

    #[test]
    fn lsp_command_split_supports_program_args() {
        let (program, args) = split_lsp_command("typescript-language-server --stdio").unwrap();

        assert_eq!(program, "typescript-language-server");
        assert_eq!(args, vec!["--stdio"]);
    }

    #[test]
    fn bridge_reuses_running_session() {
        let _guard = env_lock();
        std::env::set_var(LSP_CMD_ENV, "sleep");
        let bridge = LspBridge::from_env();
        std::env::remove_var(LSP_CMD_ENV);

        // Use the lower-level constructor with an argument for this unit test;
        // production startup uses the env-provided language-server binary.
        let mut slot = LspBridge::lock_session().unwrap();
        *slot = Some(LspServerProcess::start("sleep", &["10"]).unwrap());
        let first_pid = slot.as_ref().unwrap().id();
        drop(slot);

        assert_eq!(bridge.ensure_lsp_session().unwrap(), first_pid);
        LspBridge::stop_lsp_session().unwrap();
    }

    #[test]
    fn find_references_uses_generic_lsp_json_rpc_session() {
        let _guard = env_lock();
        if !python3_is_available_for_test() {
            eprintln!("skipping fake LSP test: python3 is not runnable");
            return;
        }

        let temp = tempfile::tempdir().unwrap();
        let script = temp.path().join("fake_lsp.py");
        std::fs::write(&script, FAKE_LSP_SERVER).unwrap();
        std::env::set_var(LSP_CMD_ENV, format!("python3 {}", script.display()));

        let refs = LspBridge::from_env()
            .find_references(&SymbolLocation {
                file: "src/lib.rs".to_string(),
                line: 1,
                column: 1,
            })
            .unwrap();

        std::env::remove_var(LSP_CMD_ENV);
        LspBridge::stop_lsp_session().unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].file, "/workspace/generic/src/lib.rs");
        assert_eq!(refs[0].line, 3);
        assert_eq!(refs[0].column, 5);
    }

    #[test]
    fn rename_symbol_uses_generic_lsp_workspace_edit() {
        let _guard = env_lock();
        if !python3_is_available_for_test() {
            eprintln!("skipping fake LSP rename test: python3 is not runnable");
            return;
        }

        let temp = tempfile::tempdir().unwrap();
        let script = temp.path().join("fake_lsp.py");
        let source = temp.path().join("lib.rs");
        std::fs::write(&script, FAKE_LSP_SERVER).unwrap();
        std::fs::write(&source, "let old = old;\n").unwrap();
        std::env::set_var(LSP_CMD_ENV, format!("python3 {}", script.display()));

        let result = LspBridge::from_env()
            .rename_symbol(
                &SymbolLocation {
                    file: source.to_string_lossy().to_string(),
                    line: 1,
                    column: 5,
                },
                "new_name",
            )
            .unwrap();

        std::env::remove_var(LSP_CMD_ENV);
        LspBridge::stop_lsp_session().unwrap();
        assert_eq!(result.files_changed, 1);
        assert_eq!(result.edits_applied, 2);
        assert_eq!(
            std::fs::read_to_string(source).unwrap(),
            "let new_name = new_name;\n"
        );
    }

    #[test]
    fn lsp_message_encoding_uses_content_length_frame() {
        let message = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize"});
        let framed = encode_lsp_message(&message);
        let text = String::from_utf8(framed).unwrap();

        assert!(text.starts_with("Content-Length: "));
        assert!(text.contains("\r\n\r\n"));
        assert!(text.ends_with(&message.to_string()));
    }

    #[test]
    fn lsp_message_drain_handles_partial_and_multiple_frames() {
        let first = serde_json::json!({"jsonrpc":"2.0","id":1,"result":{}});
        let second = serde_json::json!({"jsonrpc":"2.0","method":"window/logMessage"});
        let mut buffer = encode_lsp_message(&first);
        buffer.extend(encode_lsp_message(&second));
        buffer.extend(b"Content-Length: 999\r\n\r\n{".to_vec());

        let messages = drain_lsp_messages(&mut buffer).unwrap();

        assert_eq!(messages, vec![first, second]);
        assert!(String::from_utf8_lossy(&buffer).starts_with("Content-Length: 999"));
    }

    #[test]
    fn lsp_requests_use_expected_methods_and_one_based_input_positions() {
        let loc = SymbolLocation {
            file: "src/lib.rs".to_string(),
            line: 3,
            column: 9,
        };

        let refs = references_request(7, &loc);
        let rename = rename_request(8, &loc, "new_name");

        assert_eq!(refs["method"], "textDocument/references");
        assert_eq!(
            refs["params"]["position"],
            serde_json::json!({"line":2,"character":8})
        );
        assert_eq!(refs["params"]["context"]["includeDeclaration"], true);
        assert_eq!(rename["method"], "textDocument/rename");
        assert_eq!(rename["params"]["newName"], "new_name");
        assert!(rename["params"]["textDocument"]["uri"]
            .as_str()
            .unwrap()
            .ends_with("/src/lib.rs"));
    }

    #[test]
    fn did_open_carries_the_file_content_and_a_real_language_id() {
        // A server answers about ITS copy of a document. Announce a TypeScript file as
        // plaintext (or not at all) and the analyzer never runs on it.
        let note = did_open_notification("/repo/packages/a/src/session.ts", "export const x = 1;\n");

        assert_eq!(note["method"], "textDocument/didOpen");
        assert_eq!(note["params"]["textDocument"]["languageId"], "typescript");
        assert_eq!(note["params"]["textDocument"]["version"], 1);
        assert_eq!(
            note["params"]["textDocument"]["text"],
            "export const x = 1;\n"
        );
        assert_eq!(
            note["params"]["textDocument"]["uri"],
            file_uri("/repo/packages/a/src/session.ts")
        );
    }

    #[test]
    fn language_id_follows_the_extension_and_degrades_to_plaintext() {
        assert_eq!(language_id_for("a/b.ts"), "typescript");
        assert_eq!(language_id_for("a/b.tsx"), "typescriptreact");
        assert_eq!(language_id_for("a/b.mjs"), "javascript");
        assert_eq!(language_id_for("a/b.rs"), "rust");
        assert_eq!(language_id_for("a/b.py"), "python");
        // Unknown is not a crash and not a guess: the server decides what to do with it.
        assert_eq!(language_id_for("a/LICENSE"), "plaintext");
        assert_eq!(language_id_for("a/b"), "plaintext");
    }

    #[test]
    fn initialize_request_sets_root_uri_and_process_id() {
        let init = initialize_request("file:///workspace/project");

        assert_eq!(init["method"], "initialize");
        assert_eq!(init["params"]["rootUri"], "file:///workspace/project");
        assert!(init["params"]["processId"].as_u64().unwrap_or(0) > 0);
    }

    #[test]
    fn references_response_maps_lsp_locations_to_code_references() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": [
                {
                    "uri": "file:///workspace/refarm/src/lib.rs",
                    "range": {
                        "start": { "line": 4, "character": 12 },
                        "end": { "line": 4, "character": 20 }
                    }
                }
            ]
        });

        let refs = parse_references_response(&response).unwrap();

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].file, "/workspace/refarm/src/lib.rs");
        assert_eq!(refs[0].line, 5);
        assert_eq!(refs[0].column, 13);
        assert_eq!(refs[0].kind, "reference");
    }

    #[test]
    fn references_response_surfaces_lsp_errors() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "error": { "code": -32602, "message": "bad location" }
        });

        let err = parse_references_response(&response).unwrap_err();

        assert!(err.contains("bad location"));
    }

    #[test]
    fn rename_response_maps_workspace_changes_to_text_edits() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "changes": {
                    "file:///workspace/generic/src/lib.rs": [
                        {
                            "range": {
                                "start": { "line": 1, "character": 4 },
                                "end": { "line": 1, "character": 7 }
                            },
                            "newText": "new_name"
                        }
                    ]
                }
            }
        });

        let edits = parse_rename_response(&response).unwrap();

        assert_eq!(
            edits,
            vec![LspTextEdit {
                file: "/workspace/generic/src/lib.rs".to_string(),
                start_line: 1,
                start_character: 4,
                end_line: 1,
                end_character: 7,
                new_text: "new_name".to_string(),
            }]
        );
    }

    #[test]
    fn rename_response_maps_document_changes_to_text_edits() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "documentChanges": [
                    {
                        "textDocument": {
                            "uri": "file:///workspace/generic/src/lib.rs",
                            "version": 1
                        },
                        "edits": [
                            {
                                "range": {
                                    "start": { "line": 0, "character": 4 },
                                    "end": { "line": 0, "character": 7 }
                                },
                                "newText": "new_name"
                            }
                        ]
                    }
                ]
            }
        });

        let edits = parse_rename_response(&response).unwrap();

        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].file, "/workspace/generic/src/lib.rs");
        assert_eq!(edits[0].start_line, 0);
        assert_eq!(edits[0].new_text, "new_name");
    }

    #[test]
    fn lsp_text_edits_apply_in_reverse_order() {
        let mut content = "let old = old;\n".to_string();
        let edits = [
            LspTextEdit {
                file: "unused.rs".to_string(),
                start_line: 0,
                start_character: 4,
                end_line: 0,
                end_character: 7,
                new_text: "new_name".to_string(),
            },
            LspTextEdit {
                file: "unused.rs".to_string(),
                start_line: 0,
                start_character: 10,
                end_line: 0,
                end_character: 13,
                new_text: "new_name".to_string(),
            },
        ];

        let mut sorted = edits.to_vec();
        sorted.sort_by(|a, b| {
            (b.start_line, b.start_character, b.end_line, b.end_character).cmp(&(
                a.start_line,
                a.start_character,
                a.end_line,
                a.end_character,
            ))
        });
        for edit in &sorted {
            apply_lsp_text_edit(&mut content, edit).unwrap();
        }

        assert_eq!(content, "let new_name = new_name;\n");
    }

    #[test]
    fn encode_lsp_message_frames_exact_content_length() {
        let message = serde_json::json!({"a":1});
        let body = message.to_string(); // {"a":1} => 7 bytes
        let framed = encode_lsp_message(&message);

        assert_eq!(
            String::from_utf8(framed).unwrap(),
            format!("Content-Length: {}\r\n\r\n{}", body.len(), body)
        );
    }

    #[test]
    fn find_header_end_locates_crlf_crlf_separator() {
        let buffer = b"Content-Length: 2\r\n\r\n{}";
        // The separator begins right after "Content-Length: 2" (17 bytes).
        assert_eq!(find_header_end(buffer), Some(17));
    }

    #[test]
    fn find_header_end_is_none_without_full_separator() {
        assert_eq!(find_header_end(b"Content-Length: 2\r\n"), None);
        assert_eq!(find_header_end(b""), None);
    }

    #[test]
    fn content_length_parses_valid_header() {
        assert_eq!(content_length("Content-Length: 42").unwrap(), 42);
    }

    #[test]
    fn content_length_is_case_insensitive_and_trims() {
        assert_eq!(content_length("content-length:  7  ").unwrap(), 7);
        assert_eq!(content_length("CONTENT-LENGTH: 9").unwrap(), 9);
    }

    #[test]
    fn content_length_errors_when_header_missing() {
        let err = content_length("Content-Type: application/json").unwrap_err();
        assert!(err.contains("missing Content-Length"));
    }

    #[test]
    fn content_length_errors_when_value_unparseable() {
        let err = content_length("Content-Length: not-a-number").unwrap_err();
        assert!(err.contains("Content-Length parse"));
    }

    #[test]
    fn drain_lsp_messages_returns_single_full_frame_and_empties_buffer() {
        let message = serde_json::json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}});
        let mut buffer = encode_lsp_message(&message);

        let messages = drain_lsp_messages(&mut buffer).unwrap();

        assert_eq!(messages, vec![message]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn drain_lsp_messages_leaves_partial_frame_buffered() {
        // A complete header promising 999 bytes but only one body byte present.
        let mut buffer = b"Content-Length: 999\r\n\r\n{".to_vec();

        let messages = drain_lsp_messages(&mut buffer).unwrap();

        assert!(messages.is_empty());
        assert_eq!(buffer, b"Content-Length: 999\r\n\r\n{".to_vec());
    }

    #[test]
    fn move_request_uses_experimental_move_symbol_with_target_uri() {
        let loc = SymbolLocation {
            file: "src/lib.rs".to_string(),
            line: 3,
            column: 9,
        };

        let request = move_request(4, &loc, "src/moved.rs");

        assert_eq!(request["id"], 4);
        assert_eq!(request["method"], "experimental/moveSymbol");
        assert_eq!(
            request["params"]["position"],
            serde_json::json!({"line":2,"character":8})
        );
        assert!(request["params"]["textDocument"]["uri"]
            .as_str()
            .unwrap()
            .ends_with("/src/lib.rs"));
        assert!(request["params"]["targetUri"]
            .as_str()
            .unwrap()
            .ends_with("/src/moved.rs"));
    }

    #[test]
    fn parse_rename_response_surfaces_error() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "error": { "code": -32601, "message": "no rename" }
        });

        let err = parse_rename_response(&response).unwrap_err();

        assert!(err.contains("no rename"));
    }

    #[test]
    fn parse_rename_response_without_result_is_empty() {
        let response = serde_json::json!({ "jsonrpc": "2.0", "id": 3 });

        assert_eq!(parse_rename_response(&response).unwrap(), Vec::new());
    }

    #[test]
    fn parse_rename_response_errors_when_changes_value_not_array() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "changes": { "file:///workspace/src/lib.rs": { "not": "an array" } }
            }
        });

        let err = parse_rename_response(&response).unwrap_err();

        assert!(err.contains("must be an array"));
    }

    #[test]
    fn parse_rename_response_errors_when_document_change_missing_uri() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "documentChanges": [
                    { "textDocument": { "version": 1 }, "edits": [] }
                ]
            }
        });

        let err = parse_rename_response(&response).unwrap_err();

        assert!(err.contains("missing textDocument.uri"));
    }

    #[test]
    fn parse_rename_response_errors_when_document_change_edits_not_array() {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "result": {
                "documentChanges": [
                    {
                        "textDocument": { "uri": "file:///workspace/src/lib.rs" },
                        "edits": { "not": "an array" }
                    }
                ]
            }
        });

        let err = parse_rename_response(&response).unwrap_err();

        assert!(err.contains("edits for"));
        assert!(err.contains("must be an array"));
    }

    #[test]
    fn text_edit_from_lsp_value_parses_valid_edit() {
        let value = serde_json::json!({
            "range": {
                "start": { "line": 2, "character": 4 },
                "end": { "line": 2, "character": 9 }
            },
            "newText": "renamed"
        });

        let edit = text_edit_from_lsp_value("/workspace/src/lib.rs", &value).unwrap();

        assert_eq!(
            edit,
            LspTextEdit {
                file: "/workspace/src/lib.rs".to_string(),
                start_line: 2,
                start_character: 4,
                end_line: 2,
                end_character: 9,
                new_text: "renamed".to_string(),
            }
        );
    }

    #[test]
    fn text_edit_from_lsp_value_errors_when_range_missing() {
        let value = serde_json::json!({ "newText": "x" });

        let err = text_edit_from_lsp_value("f.rs", &value).unwrap_err();

        assert!(err.contains("missing range"));
    }

    #[test]
    fn text_edit_from_lsp_value_errors_when_range_start_missing() {
        let value = serde_json::json!({
            "range": { "end": { "line": 0, "character": 1 } },
            "newText": "x"
        });

        let err = text_edit_from_lsp_value("f.rs", &value).unwrap_err();

        assert!(err.contains("missing range.start"));
    }

    #[test]
    fn text_edit_from_lsp_value_errors_when_range_end_missing() {
        let value = serde_json::json!({
            "range": { "start": { "line": 0, "character": 1 } },
            "newText": "x"
        });

        let err = text_edit_from_lsp_value("f.rs", &value).unwrap_err();

        assert!(err.contains("missing range.end"));
    }

    #[test]
    fn text_edit_from_lsp_value_errors_when_new_text_missing() {
        let value = serde_json::json!({
            "range": {
                "start": { "line": 0, "character": 1 },
                "end": { "line": 0, "character": 2 }
            }
        });

        let err = text_edit_from_lsp_value("f.rs", &value).unwrap_err();

        assert!(err.contains("missing newText"));
    }

    #[test]
    fn file_uri_to_path_strips_file_scheme() {
        assert_eq!(
            file_uri_to_path("file:///workspace/src/lib.rs"),
            "/workspace/src/lib.rs"
        );
    }

    #[test]
    fn file_uri_to_path_passes_through_non_file_uri() {
        assert_eq!(file_uri_to_path("/already/a/path"), "/already/a/path");
        assert_eq!(file_uri_to_path("relative/path.rs"), "relative/path.rs");
    }

    #[test]
    fn lsp_position_converts_one_based_to_zero_based() {
        let loc = SymbolLocation {
            file: "src/lib.rs".to_string(),
            line: 5,
            column: 3,
        };

        assert_eq!(lsp_position(&loc), serde_json::json!({"line":4,"character":2}));
    }

    #[test]
    fn lsp_position_saturates_zero_input_to_zero() {
        let loc = SymbolLocation {
            file: "src/lib.rs".to_string(),
            line: 0,
            column: 0,
        };

        assert_eq!(lsp_position(&loc), serde_json::json!({"line":0,"character":0}));
    }

    /// The regression this file's `didOpen` + settle exist for.
    ///
    /// Before them, a positional query reached the server for a document it had never been
    /// told about, and typescript-language-server answered anyway — resolving the position
    /// against an empty buffer and returning references to unrelated symbols. The failure
    /// looked like a plausible result, not an error, which is why only a real server catches
    /// it: the fake in this file answers regardless of `didOpen`.
    #[test]
    #[ignore = "requires typescript-language-server and indexes the workspace"]
    fn live_typescript_server_resolves_the_symbol_it_was_asked_about() {
        let Some(cmd) = typescript_language_server_for_test() else {
            eprintln!("skipping: typescript-language-server is not runnable");
            return;
        };
        // SAFETY: single-threaded test; the bridge reads this at construction.
        unsafe { std::env::set_var(LSP_CMD_ENV, format!("{cmd} --stdio")) };

        let file = concat!(env!("CARGO_MANIFEST_DIR"), "/../browser-driver/src/session.ts");
        if !std::path::Path::new(file).exists() {
            eprintln!("skipping: fixture source not present at {file}");
            return;
        }
        // `createLiveFetch`, at its declaration.
        let mut loc = SymbolLocation {
            file: file.to_string(),
            line: 0,
            column: 23,
        };
        let source = std::fs::read_to_string(file).unwrap();
        loc.line = source
            .lines()
            .position(|l| l.contains("export async function createLiveFetch"))
            .map(|i| (i + 1) as u32)
            .expect("declaration present in fixture");

        let refs = LspBridge::from_env().find_references(&loc).unwrap();
        LspBridge::stop_lsp_session().unwrap();
        unsafe { std::env::remove_var(LSP_CMD_ENV) };

        // Every hit must be the symbol asked about — the pre-fix bug returned line-1 imports.
        // Read each hit from ITS OWN file: a correct answer spans files, so checking every line
        // against the queried file's source would fail on exactly the result we want.
        assert!(!refs.is_empty(), "expected references, got none");
        for reference in &refs {
            let text = std::fs::read_to_string(&reference.file)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", reference.file));
            let line = text.lines().nth(reference.line.saturating_sub(1) as usize);
            assert!(
                line.is_some_and(|l| l.contains("createLiveFetch")),
                "hit at {}:{} is not the symbol queried: {:?}",
                reference.file,
                reference.line,
                line
            );
        }
        // The settle exists so the answer reaches beyond the file just opened.
        assert!(
            refs.iter().any(|r| !r.file.ends_with("session.ts")),
            "expected a cross-file reference; the analysis had not settled: {refs:?}"
        );
    }

    fn typescript_language_server_for_test() -> Option<String> {
        let home = std::env::var("HOME").ok()?;
        let path = format!("{home}/.local/share/pnpm/bin/typescript-language-server");
        std::process::Command::new(&path)
            .arg("--version")
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|_| path)
    }

    #[test]
    #[ignore = "requires rust-analyzer and indexes the local crate"]
    fn live_rust_analyzer_find_references_returns_locations() {
        if !rust_analyzer_is_available_for_test() {
            eprintln!("skipping live rust-analyzer test: rust-analyzer is not runnable");
            return;
        }

        let loc = SymbolLocation {
            file: "src/host/lsp_bridge.rs".to_string(),
            line: 437,
            column: 4,
        };

        let refs = LspBridge::from_env().find_references(&loc).unwrap();

        LspBridge::stop_lsp_session().unwrap();
        assert!(refs.iter().any(|r| r.file.ends_with("lsp_bridge.rs")));
    }

    fn rust_analyzer_is_available_for_test() -> bool {
        std::process::Command::new("rust-analyzer")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn python3_is_available_for_test() -> bool {
        std::process::Command::new("python3")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    const FAKE_LSP_SERVER: &str = r#"
import json
import sys

def read_message():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line == b'\r\n':
            break
        name, value = line.decode('ascii').split(':', 1)
        headers[name.lower()] = value.strip()
    body = sys.stdin.buffer.read(int(headers['content-length']))
    return json.loads(body)

def send(message):
    body = json.dumps(message, separators=(',', ':')).encode('utf-8')
    sys.stdout.buffer.write(b'Content-Length: ' + str(len(body)).encode('ascii') + b'\r\n\r\n' + body)
    sys.stdout.buffer.flush()

while True:
    message = read_message()
    if message is None:
        break
    method = message.get('method')
    if method == 'initialize':
        send({'jsonrpc': '2.0', 'id': message['id'], 'result': {'capabilities': {}}})
    elif method == 'textDocument/references':
        send({
            'jsonrpc': '2.0',
            'id': message['id'],
            'result': [{
                'uri': 'file:///workspace/generic/src/lib.rs',
                'range': {
                    'start': {'line': 2, 'character': 4},
                    'end': {'line': 2, 'character': 8},
                },
            }],
        })
    elif method == 'textDocument/rename':
        uri = message['params']['textDocument']['uri']
        new_name = message['params']['newName']
        send({
            'jsonrpc': '2.0',
            'id': message['id'],
            'result': {
                'changes': {
                    uri: [
                        {
                            'range': {
                                'start': {'line': 0, 'character': 4},
                                'end': {'line': 0, 'character': 7},
                            },
                            'newText': new_name,
                        },
                        {
                            'range': {
                                'start': {'line': 0, 'character': 10},
                                'end': {'line': 0, 'character': 13},
                            },
                            'newText': new_name,
                        },
                    ],
                },
            },
        })
"#;
}
