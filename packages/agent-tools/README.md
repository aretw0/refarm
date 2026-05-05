# @refarm.dev/agent-tools

Rust/WASM component providing sandboxed filesystem, subprocess, and structured I/O capabilities for AI agents running inside WASM guest environments. Exposes three WIT interfaces: `agent-fs`, `agent-shell`, and `structured-io`.

## When to use

- You are building a WASM agent plugin that needs to read/write files, run subprocesses, or parse structured data (JSON/TOML/YAML) with validation.
- You need a policy-enforceable boundary between an AI agent and the host OS (timeout caps, path restrictions, argv enforcement).
- You are targeting both browser OPFS and Node.js WASI runtimes — all I/O is WASI-mapped.

## Architecture

```
Agent (WASM guest)
  └─ agent-tools component
       ├─ agent-fs       ← atomic read/write/edit via WASI filesystem
       ├─ agent-shell    ← policy-gated subprocess via host_spawn
       └─ structured-io  ← JSON/TOML/YAML parse + validate before write
```

All filesystem operations use WASI (`wasi:filesystem`), making them transparent across browser OPFS and Node.js WASI environments.

## WIT interfaces

### `agent-fs`

```wit
read(path: string) -> result<list<u8>, string>
write(path: string, content: list<u8>)         // atomic: tmp + rename
edit(path: string, diff: string)               // apply unified diff (diffy)
```

### `agent-shell`

```wit
spawn(req: spawn-request) -> result<spawn-result, string>
// Policy: 30-second timeout cap, non-empty argv enforced
```

### `structured-io`

```wit
read-structured(path: string, format: file-format?, page-size: u32, page-offset: u32)
  -> result<structured-content, string>

write-structured(path: string, content: string, format: file-format?)
  -> result<_, string>  // validates JSON/TOML/YAML before writing
```

Supported formats: `json`, `toml`, `yaml` (auto-detected from extension if format omitted).

## Build

```bash
cargo build --target wasm32-wasi --release
# or via workspace:
pnpm --filter @refarm.dev/agent-tools build
```

## Policy enforcement

- **Subprocess timeout**: capped at 30 seconds regardless of caller request.
- **Argv**: non-empty argv is enforced — empty command is rejected.
- **Writes**: structured writes validate content before touching disk; on parse error, the file is not modified.
- **Atomic writes**: plain `write()` uses a tmp file + rename to prevent partial writes on crash.

## Related ADRs

- [ADR-050](../../specs/ADRs/ADR-050-zig-wasm-agent-tool-host.md) — WASM agent tool host strategy
- [ADR-017](../../specs/ADRs/ADR-017-microkernel-boundary.md) — microkernel guest/host boundary

## License

MIT
