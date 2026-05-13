# `llm` → `model` Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every `llm`/`LLM` identifier, env var, and WIT interface name to `model`/`MODEL` across the entire monorepo — no backward-compat shims, pre-release project.

**Architecture:** WIT interface `llm-bridge` → `model-bridge` (source of truth); `cargo build` regenerates Rust bindings automatically; TypeScript, env vars, and docs updated to match.

**Tech Stack:** Rust (cargo/wit-bindgen), TypeScript (Vitest), WIT component model, bash grep/sed.

**⚠ Prerequisite for:** `2026-05-13-graceful-plugin-reload.md` — complete this plan first, then the reload plan.

---

## File Map

| File | Change |
|---|---|
| `packages/refarm-plugin-wit/wit/refarm-plugin-host.wit` | Rename `interface llm-bridge` → `model-bridge` |
| `packages/pi-agent/wit/world.wit` | Rename `import llm-bridge` → `import model-bridge` |
| `packages/pi-agent/src/bindings.rs` | **Auto-generated** — do not edit; `cargo build` regenerates |
| `packages/pi-agent/src/provider.rs` | Module use + env vars + function calls |
| `packages/pi-agent/src/lib.rs` | Env var docs + runtime env sets + capability string |
| `packages/pi-agent/src/streaming_config.rs` | Const rename |
| `packages/pi-agent/src/compress.rs` | Env var |
| `packages/pi-agent/src/extensibility_contract.rs` | set/remove env calls |
| `packages/pi-agent/src/response_nodes.rs` | Schema key `"llm"` → `"inference"` |
| `packages/tractor-ts/src/lib/wasi-imports.ts` | Interface key + env vars + local vars + error msgs |
| `packages/tractor-ts/test/wasi-imports.test.ts` | Interface key + env var names |
| `apps/farmhand/src/index.ts` | Const + function name + env var |
| `apps/refarm/src/commands/ask.ts` | Env var + .env pattern + error strings |
| `apps/refarm/src/commands/keys.ts` | Description string |
| `apps/refarm/src/commands/session-launch.ts` | Env var + error strings |
| `specs/ADRs/ADR-053-host-proxied-llm-streaming.md` | Rename file + update content |
| Other ADRs + `docs/` | Update `llm-bridge` and `LLM_*` references |

---

## Task 1: Rename WIT interface

**Files:**
- Modify: `packages/refarm-plugin-wit/wit/refarm-plugin-host.wit`
- Modify: `packages/pi-agent/wit/world.wit`

- [ ] **Step 1: Update `refarm-plugin-host.wit`**

Apply these three changes:

```wit
// OLD — doc comment (line starting with "/// Host-proxied LLM")
/// Host-proxied LLM completion bridge.
// NEW
/// Host-proxied model completion bridge.

// OLD — interface declaration
interface llm-bridge {
// NEW
interface model-bridge {

// OLD — import in world (bottom of file)
    import llm-bridge;
// NEW
    import model-bridge;
```

- [ ] **Step 2: Update `packages/pi-agent/wit/world.wit`**

```wit
// OLD (line 7)
    import llm-bridge;
// NEW
    import model-bridge;
```

- [ ] **Step 3: Verify no remaining `llm-bridge` in WIT files**

```bash
grep -r "llm-bridge" packages/refarm-plugin-wit packages/pi-agent/wit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add packages/refarm-plugin-wit/wit/refarm-plugin-host.wit \
        packages/pi-agent/wit/world.wit
git commit -m "refactor(wit): rename llm-bridge → model-bridge interface"
```

---

## Task 2: Update pi-agent Rust source

**Files:**
- Modify: `packages/pi-agent/src/provider.rs`
- Modify: `packages/pi-agent/src/lib.rs`
- Modify: `packages/pi-agent/src/streaming_config.rs`
- Modify: `packages/pi-agent/src/compress.rs`
- Modify: `packages/pi-agent/src/extensibility_contract.rs`
- Modify: `packages/pi-agent/src/response_nodes.rs`

- [ ] **Step 1: Update `provider.rs`**

```rust
// Line 1 — module import
// OLD
use crate::refarm::plugin::llm_bridge;
// NEW
use crate::refarm::plugin::model_bridge;

// Line 27 — model env var
// OLD
let explicit_model = std::env::var("LLM_MODEL").unwrap_or_default();
// NEW
let explicit_model = std::env::var("MODEL_ID").unwrap_or_default();

// Line 36 — base URL env var
// OLD
let base_url = std::env::var("LLM_BASE_URL").unwrap_or_else(|_| default_base.to_owned());
// NEW
let base_url = std::env::var("MODEL_BASE_URL").unwrap_or_else(|_| default_base.to_owned());

// Line 85 — non-streaming call
// OLD
llm_bridge::complete_http(provider, base_url, path, headers, body)
// NEW
model_bridge::complete_http(provider, base_url, path, headers, body)

// Lines 112–118 — streaming call (two occurrences of llm_bridge)
// OLD
let response = llm_bridge::complete_http_stream(
    ...
    &llm_bridge::StreamResponseMetadata {
// NEW
let response = model_bridge::complete_http_stream(
    ...
    &model_bridge::StreamResponseMetadata {
```

- [ ] **Step 2: Update `streaming_config.rs`**

```rust
// OLD
pub(crate) const LLM_STREAM_RESPONSES_ENV: &str = "LLM_STREAM_RESPONSES";
// NEW
pub(crate) const MODEL_STREAM_RESPONSES_ENV: &str = "MODEL_STREAM_RESPONSES";
```

Also update any usage of `LLM_STREAM_RESPONSES_ENV` within the same file.

- [ ] **Step 3: Update `compress.rs`**

```rust
// OLD
let max_lines = std::env::var("LLM_TOOL_OUTPUT_MAX_LINES")
// NEW
let max_lines = std::env::var("MODEL_TOOL_OUTPUT_MAX_LINES")
```

- [ ] **Step 4: Update `extensibility_contract.rs`**

```rust
// OLD
std::env::set_var("LLM_PROVIDER", name);
// NEW
std::env::set_var("MODEL_PROVIDER", name);

// OLD
std::env::remove_var("LLM_PROVIDER");
// NEW
std::env::remove_var("MODEL_PROVIDER");

// OLD
std::env::remove_var("LLM_DEFAULT_PROVIDER");
// NEW
std::env::remove_var("MODEL_DEFAULT_PROVIDER");
```

- [ ] **Step 5: Update `response_nodes.rs`**

```rust
// OLD — schema key (inside the JSON macro/string, line ~44)
"llm": {
    "model":       payload.model,
    "tokens_in":   payload.tokens_in,
    "tokens_out":  payload.tokens_out,
    "duration_ms": payload.duration_ms,
},
// NEW — "inference" avoids the redundant "model.model" nesting
"inference": {
    "model":       payload.model,
    "tokens_in":   payload.tokens_in,
    "tokens_out":  payload.tokens_out,
    "duration_ms": payload.duration_ms,
},
```

- [ ] **Step 6: Update `lib.rs` — module doc comment env vars**

The module doc comment (lines 1–35) lists all env vars. Apply all renames:

| Old | New |
|---|---|
| `LLM_PROVIDER` | `MODEL_PROVIDER` |
| `LLM_DEFAULT_PROVIDER` | `MODEL_DEFAULT_PROVIDER` |
| `LLM_MODEL` | `MODEL_ID` |
| `LLM_BASE_URL` | `MODEL_BASE_URL` |
| `LLM_MAX_CONTEXT_TOKENS` | `MODEL_MAX_CONTEXT_TOKENS` |
| `LLM_FALLBACK_PROVIDER` | `MODEL_FALLBACK_PROVIDER` |
| `LLM_BUDGET_<PROVIDER>_USD` | `MODEL_BUDGET_<PROVIDER>_USD` |
| `LLM_HISTORY_TURNS` | `MODEL_HISTORY_TURNS` |
| `LLM_TOOL_CALL_MAX_ITER` | `MODEL_TOOL_CALL_MAX_ITER` |
| `LLM_TOOL_OUTPUT_MAX_LINES` | `MODEL_TOOL_OUTPUT_MAX_LINES` |
| `LLM_STREAM_RESPONSES` | `MODEL_STREAM_RESPONSES` |
| `LLM_SYSTEM` | `MODEL_SYSTEM` |
| `LLM_SESSION_ID` | `MODEL_SESSION_ID` |

- [ ] **Step 7: Update `lib.rs` — runtime env sets and capability string**

```rust
// Line ~200 (wasm32 branch)
// OLD
let _session = EnvGuard::maybe_set("LLM_SESSION_ID", req.session_id.as_deref());
let _turns   = EnvGuard::maybe_set("LLM_HISTORY_TURNS", turns_str.as_deref());
// NEW
let _session = EnvGuard::maybe_set("MODEL_SESSION_ID", req.session_id.as_deref());
let _turns   = EnvGuard::maybe_set("MODEL_HISTORY_TURNS", turns_str.as_deref());

// Line ~228 (non-wasm32 branch)
// OLD
let _system  = EnvGuard::maybe_set("LLM_SYSTEM",       req.system.as_deref());
let _session = EnvGuard::maybe_set("LLM_SESSION_ID",   req.session_id.as_deref());
let _turns   = EnvGuard::maybe_set("LLM_HISTORY_TURNS", turns_str.as_deref());
// NEW
let _system  = EnvGuard::maybe_set("MODEL_SYSTEM",       req.system.as_deref());
let _session = EnvGuard::maybe_set("MODEL_SESSION_ID",   req.session_id.as_deref());
let _turns   = EnvGuard::maybe_set("MODEL_HISTORY_TURNS", turns_str.as_deref());

// Line ~282 — required_capabilities vec
// OLD
"llm-bridge".to_string(),
// NEW
"model-bridge".to_string(),
```

- [ ] **Step 8: Verify no remaining `llm` / `LLM` in Rust source**

```bash
grep -rn "llm\|LLM" packages/pi-agent/src --include="*.rs"
```

Expected: no output (comments in test files mentioning "llm" for explanation are acceptable, but all identifiers and env vars must be gone).

- [ ] **Step 9: Build pi-agent to regenerate bindings**

```bash
cd packages/pi-agent && cargo build 2>&1 | tail -5
```

Expected: compiles successfully. The `bindings.rs` is auto-regenerated and will now contain `pub mod model_bridge` instead of `pub mod llm_bridge`.

- [ ] **Step 10: Run pi-agent tests**

```bash
cd packages/pi-agent && cargo test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/pi-agent/src/provider.rs \
        packages/pi-agent/src/lib.rs \
        packages/pi-agent/src/streaming_config.rs \
        packages/pi-agent/src/compress.rs \
        packages/pi-agent/src/extensibility_contract.rs \
        packages/pi-agent/src/response_nodes.rs \
        packages/pi-agent/src/bindings.rs
git commit -m "refactor(pi-agent): llm→model — env vars, module use, schema key"
```

---

## Task 3: Update tractor-ts

**Files:**
- Modify: `packages/tractor-ts/src/lib/wasi-imports.ts`
- Modify: `packages/tractor-ts/test/wasi-imports.test.ts`

- [ ] **Step 1: Update `wasi-imports.ts` — interface key**

```typescript
// OLD (line ~413)
"refarm:plugin/llm-bridge": {
// NEW
"refarm:plugin/model-bridge": {
```

- [ ] **Step 2: Update `wasi-imports.ts` — env var names**

```typescript
// OLD (line ~140)
const mockLlmBodyRaw = process.env.REFARM_MOCK_LLM_BODY;
// NEW
const mockModelBodyRaw = process.env.REFARM_MOCK_MODEL_BODY;

// OLD (line ~353)
String(Number(process.env.REFARM_LLM_HTTP_TIMEOUT_SEC ?? "60") || 60),
// NEW
String(Number(process.env.REFARM_MODEL_HTTP_TIMEOUT_SEC ?? "60") || 60),
```

- [ ] **Step 3: Update `wasi-imports.ts` — local variable names**

Rename all `mockLlm*` variables to `mockModel*` throughout the file:
- `mockLlmBodyRaw` → `mockModelBodyRaw`
- `mockLlmBody` → `mockModelBody`
- `mockLlmBytes` → `mockModelBytes`
- `mockLlmContent` → `mockModelContent`
- `llmUrl` → `modelUrl`

- [ ] **Step 4: Update `wasi-imports.ts` — error messages**

```typescript
// OLD (line ~23)
throw new Error("llm-bridge requires Node.js child_process.spawnSync");
// NEW
throw new Error("model-bridge requires Node.js child_process.spawnSync");

// OLD (line ~220)
`... run npm run agent:keys, or use LLM_PROVIDER=ollama.`
// NEW
`... run refarm sow, or use MODEL_PROVIDER=ollama.`

// OLD (line ~231)
throw new Error(`Invalid LLM base-url: "${baseUrl}"`);
// NEW
throw new Error(`Invalid model base-url: "${baseUrl}"`);

// OLD (line ~234)
throw new Error("Invalid LLM path: path is empty");
// NEW
throw new Error("Invalid model path: path is empty");

// OLD (line ~374)
throw new Error(`llm-bridge http error: ${resp.error.message}`);
// NEW
throw new Error(`model-bridge http error: ${resp.error.message}`);

// OLD (line ~382)
`llm-bridge request failed for provider "${providerName ...
// NEW
`model-bridge request failed for provider "${providerName ...

// OLD (line ~388)
throw new Error("llm-bridge response body too large");
// NEW
throw new Error("model-bridge response body too large");
```

- [ ] **Step 5: Update `wasi-imports.test.ts`**

```typescript
// OLD (line ~262)
describe("WasiImports — refarm:plugin/llm-bridge", () => {
// NEW
describe("WasiImports — refarm:plugin/model-bridge", () => {

// OLD (line ~266)
delete process.env.REFARM_MOCK_LLM_BODY;
// NEW
delete process.env.REFARM_MOCK_MODEL_BODY;

// OLD (lines ~273, ~294)
const llmBridge = imports["refarm:plugin/llm-bridge"]!;
// NEW
const modelBridge = imports["refarm:plugin/model-bridge"]!;

// OLD (line ~276, ~296)
llmBridge["complete-http"]!(...)
// NEW
modelBridge["complete-http"]!(...)

// OLD (line ~287)
process.env.REFARM_MOCK_LLM_BODY = JSON.stringify({ ... });
// NEW
process.env.REFARM_MOCK_MODEL_BODY = JSON.stringify({ ... });
```

- [ ] **Step 6: Verify no remaining `llm` / `LLM` in tractor-ts**

```bash
grep -rn "llm\|LLM" packages/tractor-ts/src packages/tractor-ts/test --include="*.ts"
```

Expected: no output.

- [ ] **Step 7: Run tractor-ts tests**

```bash
cd packages/tractor-ts && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/tractor-ts/src/lib/wasi-imports.ts \
        packages/tractor-ts/test/wasi-imports.test.ts
git commit -m "refactor(tractor-ts): llm-bridge → model-bridge host imports + env vars"
```

---

## Task 4: Update farmhand and refarm CLI

**Files:**
- Modify: `apps/farmhand/src/index.ts`
- Modify: `apps/refarm/src/commands/ask.ts`
- Modify: `apps/refarm/src/commands/keys.ts`
- Modify: `apps/refarm/src/commands/session-launch.ts`

- [ ] **Step 1: Update `farmhand/src/index.ts`**

```typescript
// OLD (line 157)
const LLM_ENV_KEY: Record<string, string> = {
// NEW
const MODEL_ENV_KEY: Record<string, string> = {

// OLD (line 169)
async function injectSiloLlmEnv(): Promise<void> {
// NEW
async function injectSiloModelEnv(): Promise<void> {

// OLD (lines 175–176)
if (provider && !process.env.LLM_PROVIDER) {
    process.env.LLM_PROVIDER = provider;
// NEW
if (provider && !process.env.MODEL_PROVIDER) {
    process.env.MODEL_PROVIDER = provider;

// OLD (line 179)
const envKey = LLM_ENV_KEY[provider];
// NEW
const envKey = MODEL_ENV_KEY[provider];

// OLD (line 191)
await injectSiloLlmEnv();
// NEW
await injectSiloModelEnv();
```

- [ ] **Step 2: Update `ask.ts`**

```typescript
// OLD (line 302)
if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER;
// NEW
if (process.env.MODEL_PROVIDER) return process.env.MODEL_PROVIDER;

// OLD (line 307)
const match = content.match(/^\s*LLM_PROVIDER\s*=\s*(\S+)/m);
// NEW
const match = content.match(/^\s*MODEL_PROVIDER\s*=\s*(\S+)/m);

// OLD (line 380)
message.includes("llm-bridge request failed") ||
// NEW
message.includes("model-bridge request failed") ||

// OLD (line 391)
console.error(chalk.red(`\n✗  LLM provider unavailable: ${provider}`));
// NEW
console.error(chalk.red(`\n✗  Model provider unavailable: ${provider}`));

// OLD (line 424)
console.error(chalk.red("\n✗  No LLM provider configured."));
// NEW
console.error(chalk.red("\n✗  No model provider configured."));
```

- [ ] **Step 3: Update `keys.ts`**

```typescript
// OLD (line 10)
.description("Configure LLM provider API keys (stored in .refarm/.env)")
// NEW
.description("Configure model provider API keys (stored in .refarm/.env)")
```

- [ ] **Step 4: Update `session-launch.ts`**

```typescript
// OLD (line 57)
if (process.env.LLM_PROVIDER) return true;
// NEW
if (process.env.MODEL_PROVIDER) return true;

// OLD (line 178)
chalk.dim("   Configure your LLM provider:  ") + chalk.cyan("refarm keys"),
// NEW
chalk.dim("   Configure your model provider:  ") + chalk.cyan("refarm sow"),

// OLD (line 188)
console.error(chalk.red("✗  No LLM provider configured.\n"));
// NEW
console.error(chalk.red("✗  No model provider configured.\n"));
```

- [ ] **Step 5: Verify no remaining `llm` / `LLM` in apps/**

```bash
grep -rn "llm\|LLM" apps/ --include="*.ts" | grep -v "node_modules\|dist/"
```

Expected: no output.

- [ ] **Step 6: Run farmhand and refarm tests**

```bash
cd apps/farmhand && npm test
cd apps/refarm && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/farmhand/src/index.ts \
        apps/refarm/src/commands/ask.ts \
        apps/refarm/src/commands/keys.ts \
        apps/refarm/src/commands/session-launch.ts
git commit -m "refactor(apps): LLM_PROVIDER → MODEL_PROVIDER env var + error strings"
```

---

## Task 5: Update ADRs and documentation

**Files:**
- Rename + modify: `specs/ADRs/ADR-053-host-proxied-llm-streaming.md`
- Modify: several other ADRs and `docs/` files (see list below)

- [ ] **Step 1: Rename ADR-053**

```bash
git mv specs/ADRs/ADR-053-host-proxied-llm-streaming.md \
        specs/ADRs/ADR-053-host-proxied-model-streaming.md
```

- [ ] **Step 2: Update ADR-053 content**

Open `specs/ADRs/ADR-053-host-proxied-model-streaming.md` and replace all occurrences of:
- `llm-bridge` → `model-bridge`
- `LLM_PROVIDER` → `MODEL_PROVIDER`
- `LLM` (when referring to the concept) → `model`
- Title: "Host-Proxied LLM Streaming" → "Host-Proxied Model Streaming"

- [ ] **Step 3: Update other ADRs**

Files to update (replace `llm-bridge`, `LLM_*`, `LLM provider` with `model-bridge`, `MODEL_*`, `model provider`):

```bash
# Find all affected ADR files
grep -rln "llm\|LLM" specs/ADRs/ docs/
```

Open each returned file and apply the same substitutions. Key files from earlier scan:
- `specs/ADRs/ADR-012-hybrid-model-routing-for-pi-agent-harness.md`
- `specs/ADRs/ADR-031-pluggable-relational-storage.md`
- `specs/ADRs/ADR-054-generic-stream-observations.md`
- `specs/ADRs/ADR-055-stream-contract-v1-transport-layer.md`
- `specs/ADRs/ADR-057-task-session-contracts.md`
- `specs/ADRs/ADR-058-context-injection-doctrine.md`
- `specs/ADRs/ADR-065-farmhand-transparent-lifecycle.md`
- `specs/ADRs/README.md` (index — update ADR-053 entry title)
- `specs/diagrams/ARCH_GUIDE.md`
- `specs/features/context-provider-v1.md`
- `specs/features/pi-agent-effort-bridge.md`
- `docs/agent-streaming.md`
- `docs/AGENT_TRACTOR_INTEGRATION.md`
- `docs/ARCHITECTURE.md`
- `docs/INDEX.md`
- `docs/INSPIRATIONS.md`
- `docs/PROCESS_PLAYBOOK.md`
- `docs/REFARM_PERSONAL_DAILY_DRIVER.md`
- `docs/USER_STORY.md`

- [ ] **Step 4: Verify no remaining `llm` / `LLM` across the repo**

```bash
grep -rn "llm\|LLM" specs/ docs/ --include="*.md" | grep -v "COMPACTATION\|.pi-lens\|node_modules"
```

Expected: no output (or only meta-references like "this doc used to say LLM").

- [ ] **Step 5: Commit**

```bash
git add specs/ docs/
git commit -m "docs: llm → model rename in ADRs and documentation (ADR-053 renamed)"
```

---

## Final verification

- [ ] **Full repo grep — confirm clean**

```bash
grep -rn "llm\|LLM\|llm-bridge" \
  packages/ apps/ specs/ docs/ \
  --include="*.ts" --include="*.rs" --include="*.wit" --include="*.md" \
  | grep -v "node_modules\|dist/\|target/\|bindings.rs\|.pi-lens\|COMPACTATION"
```

Expected: no output.

- [ ] **Run all TypeScript tests**

```bash
cd /workspaces/refarm && npm test 2>&1 | tail -20
```

Expected: all suites pass.
