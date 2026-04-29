use std::io::{Read as _, Write as _};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::host::plugin_host::refarm::plugin::code_ops::{
    CodeReference, RenameResult, SymbolLocation,
};

const DEFAULT_RUST_LSP_CMD: &str = "rust-analyzer";
const LSP_CMD_ENV: &str = "REFACTOR_LSP_CMD";
const LEGACY_LSP_CMD_ENV: &str = "REFACTOR_LSP_RUST_ANALYZER_CMD";
const LSP_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

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
    pub(crate) fn from_env() -> Self {
        let lsp_cmd = configured_lsp_command();

        Self { lsp_cmd }
    }

    pub(crate) fn rename_symbol(
        &self,
        _loc: &SymbolLocation,
        _new_name: &str,
    ) -> Result<RenameResult, String> {
        Err(self.not_connected_message("rename"))
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
        let response =
            session.request_response(&references_request(2, loc), LSP_REQUEST_TIMEOUT)?;
        parse_references_response(&response)
    }

    fn not_connected_message(&self, op: &str) -> String {
        if command_looks_resolvable(&self.lsp_cmd) {
            format!("lsp not connected — language server configured but session not started ({op})")
        } else {
            format!(
                "lsp not connected — configured language server command not found: {}",
                self.lsp_cmd
            )
        }
    }

    fn session_slot() -> &'static Mutex<Option<LspServerProcess>> {
        LSP_SESSION.get_or_init(|| Mutex::new(None))
    }

    fn lock_session() -> Result<MutexGuard<'static, Option<LspServerProcess>>, String> {
        Self::session_slot()
            .lock()
            .map_err(|_| "lsp session lock poisoned".to_string())
    }

    #[allow(dead_code)]
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

    #[allow(dead_code)]
    fn stop_lsp_session() -> Result<(), String> {
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

    loop {
        let Some(header_end) = find_header_end(buffer) else {
            break;
        };
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

#[allow(dead_code)]
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

fn command_looks_resolvable(cmd: &str) -> bool {
    let Ok((program, _args)) = split_lsp_command(cmd) else {
        return false;
    };

    command_program_looks_resolvable(&program)
}

fn command_program_looks_resolvable(cmd: &str) -> bool {
    if cmd.contains(std::path::MAIN_SEPARATOR) {
        return std::path::Path::new(cmd).is_file();
    }

    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .map(|p| p.join(cmd))
                .any(|candidate| candidate.is_file())
        })
        .unwrap_or(false)
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

fn configured_lsp_command() -> String {
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
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
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
"#;
}
