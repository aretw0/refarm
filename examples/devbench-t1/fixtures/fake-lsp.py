#!/usr/bin/env python3
# A minimal fake LSP server for the code-ops demo — the SAME shape tractor's
# agent_harness uses (FAKE_LSP_CODE_OPS_SERVER). It answers initialize, then
# textDocument/references and textDocument/rename with deterministic edits, so the
# lsp-code-ops plugin's code-ops import resolves without a real rust-analyzer. The
# demo is about the sandboxed editor-ops PLUGIN, not the language server.
import json
import sys


def read_message():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line == b"\r\n":
            break
        name, value = line.decode("ascii").split(":", 1)
        headers[name.lower()] = value.strip()
    body = sys.stdin.buffer.read(int(headers["content-length"]))
    return json.loads(body)


def send(message):
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(
        b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body
    )
    sys.stdout.buffer.flush()


REF_RANGES = [
    {"start": {"line": 0, "character": 4}, "end": {"line": 0, "character": 7}},
    {"start": {"line": 0, "character": 10}, "end": {"line": 0, "character": 13}},
]

while True:
    message = read_message()
    if message is None:
        break
    method = message.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"capabilities": {}}})
    elif method == "textDocument/references":
        uri = message["params"]["textDocument"]["uri"]
        send(
            {
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": [{"uri": uri, "range": r} for r in REF_RANGES],
            }
        )
    elif method == "textDocument/rename":
        uri = message["params"]["textDocument"]["uri"]
        new_name = message["params"]["newName"]
        send(
            {
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {
                    "changes": {
                        uri: [
                            {"range": r, "newText": new_name} for r in REF_RANGES
                        ]
                    }
                },
            }
        )
    elif method == "experimental/moveSymbol":
        # A move is a WorkspaceEdit like rename: delete the symbol at the source and
        # insert it at the target. The host parses this exactly like a rename response.
        src = message["params"]["textDocument"]["uri"]
        target = message["params"]["targetUri"]
        send(
            {
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {
                    "changes": {
                        src: [{"range": REF_RANGES[0], "newText": ""}],
                        target: [{"range": REF_RANGES[0], "newText": "moved"}],
                    }
                },
            }
        )
