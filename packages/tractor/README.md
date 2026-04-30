# tractor (Rust)

Sovereign WASM plugin host — native Rust implementation of the Refarm Tractor.

Provides full behavioral parity with `@refarm.dev/tractor` (TypeScript), with:
- **~10 MB** binary footprint (no Node.js / V8)
- **wasmtime** WASM Component Model host (no JCO transpilation)
- **rusqlite** with the same schema as `packages/storage-sqlite`
- **loro** Rust CRDT engine (binary-compatible with `loro-crdt` JS)
- **WebSocket daemon** on port 42000 (replaces farmhand — `BrowserSyncClient` unchanged)
- **Embeddable lib** for Electron, CLI agents, RPi

---

## Quick Start

```bash
cargo build --release -p tractor
./target/release/tractor --namespace default --port 42000
```

---

## How to Build

```bash
cargo build -p tractor
cargo test  -p tractor
cargo build --release -p tractor   # ~27 MB binary
```

---

## Development (inside Dev Container)

**Memory constraints:** The dev container runs with ~7.6 GB RAM (WSL2). `wasmtime v26` is one of
the heaviest crates in the ecosystem (~1–2 GB RAM per compilation unit). Two mitigations are in
place:

- `.cargo/config.toml` caps parallel jobs at 6 (default is `nproc = 16`)
- `[profile.dev] debug = 1` uses line-tables-only DWARF (saves ~40% RAM vs full debug info)
- `rust-analyzer.check.command` is set to `"check"` (not `"clippy"`) to avoid background recompilation

**Never run these in parallel inside the container:**

```bash
# Correct — run separately
cargo test -p tractor -- --test-threads=1
cargo clippy -p tractor

# Avoid — triggers simultaneous compilation of all targets
cargo test --all
```

---

## How to Run

```bash
# Start daemon (replaces farmhand on port 42000)
./target/release/tractor --namespace default --port 42000

# Development mode (no signing)
./target/release/tractor --security-mode none --log-level debug
```

---

## Prompt / Watch CLI (ephemeral fallback)

`tractor` now ships minimal operator commands for the `user:prompt` WS path plus storage-based watching:

```bash
# Send prompt to a registered plugin (default agent: pi-agent)
./target/release/tractor prompt \
  --ws-port 42000 \
  --namespace default \
  --agent pi-agent \
  --payload "resuma o status do nó"

# Fire-and-forget (don't wait for final response)
./target/release/tractor prompt --payload "oi" --wait-timeout-ms 0

# Watch new AgentResponse nodes from storage
./target/release/tractor watch --namespace default --agent pi-agent --until-final

# Inspect generic stream observations for one prompt stream
./target/release/tractor query \
  --namespace default \
  --type StreamChunk \
  --stream-ref urn:tractor:stream:agent-response:<prompt-ref>

# Watch generic stream lifecycle/chunks until a terminal marker appears
./target/release/tractor watch \
  --namespace default \
  --type StreamSession \
  --stream-ref urn:tractor:stream:agent-response:<prompt-ref> \
  --until-final
```

Notes:
- `prompt` sends JSON text frame: `{ "type": "user:prompt", "agent": "...", "payload": "..." }`.
- Waiting/watching uses SQLite polling (`AgentResponse` by default) as a resilient fallback path.
- Generic stream observation polling supports `StreamChunk` and `StreamSession` via `--type` plus `--stream-ref`.

---

## API

For embedding `tractor` as a library in Electron apps, CLI agents, or other Rust programs:

```rust
use tractor::TractorNative;

let config = TractorNativeConfig {
    namespace: "my-app".to_string(),
    port: 42000,
    security_mode: SecurityMode::Strict,
    telemetry_capacity: 1000,
};
let tractor = TractorNative::boot(config).await?;
// load plugins
let handle = tractor.load_plugin(Path::new("my-plugin.wasm"))?;
// ... use daemon via WebSocket on port 42000
tractor.shutdown().await?;
```

---

## CLI Flags

Daemon mode (default, no subcommand):

| Flag | Default | Effect |
|---|---|---|
| `--namespace <NAME>` | `default` | SQLite path (`~/.local/share/refarm/<NAME>.db`) or `:memory:` |
| `--port <PORT>` | `42000` | TCP port for the WebSocket daemon |
| `--security-mode <MODE>` | `strict` | `strict` / `permissive` / `none` |
| `--log-level <LEVEL>` | `info` | `trace` / `debug` / `info` / `warn` / `error` |
| `--plugin <PATH>` | *(none)* | Load a WASM plugin at startup; repeatable |
| `--llm-stream-responses` | `false` | Set `LLM_STREAM_RESPONSES=1` before startup plugins load |

Prompt/watch-specific flags are available via:
- `tractor prompt --help`
- `tractor watch --help`

---

## When to Use Rust vs TypeScript

| Scenario | Package |
|---|---|
| Edge / IoT devices (Raspberry Pi, embedded, no Node.js) | `tractor` (this crate) |
| CLI agents and production daemons | `tractor` (this crate) |
| Browser plugins and extensions | `@refarm.dev/tractor` (`packages/tractor-ts`) |
| Node.js integrations and existing TS projects | `@refarm.dev/tractor` (`packages/tractor-ts`) |

Both implementations share the same WIT contracts, the same SQLite schema, and the same binary
Loro protocol — they are fully interoperable.

---

## Architecture

Design rationale, module structure, and data-flow diagrams:
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## Roadmap

Roadmap with specifications, known challenges, and graduation criteria:
**[docs/ROADMAP.md](docs/ROADMAP.md)**

Linked to the project main roadmap: **[roadmaps/MAIN.md](../../roadmaps/MAIN.md)**

---

## Graduation ✅ (ADR-048, 2026-03-19)

`tractor-native` graduated to `tractor`. All 52 tests pass.
- TS package moved to `packages/tractor-ts` (npm name unchanged: `@refarm.dev/tractor`)
- This crate: `packages/tractor`, crate name `tractor`, binary `tractor`
- ADR: `specs/ADRs/ADR-048-tractor-graduation.md`
