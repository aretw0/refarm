# Pi ↔ Refarm Interoperability Spec

> **What problem are we solving?** Pi (pi.dev) and refarm tend toward
> interoperability without friction. Users should be able to use both without
> context-switching overhead — shared skills, shared memory schema, shared
> protocol for agents talking to each other. This spec maps what is already
> interoperable, what requires deliberate alignment, and what would need porting.

---

## What interoperability means in practice

A user who codes with Pi in one project and refarm in another should:
- Use the same skills in both without copying files
- Share `.project/` memory between sessions when working on the same codebase
- Have agents in both ecosystems that can call each other without a custom bridge
- Migrate a Pi Extension to refarm (or vice versa) with a clear path

---

## Layer 1: Skills (already interoperable)

Markdown-based skills work identically in Pi and refarm. The skill format is
the shared protocol: a Markdown file with front matter activating on user request.

agents-lab already curates for both ecosystems from a single repository. A skill
installed in Pi works in refarm without modification.

**What this means**: any skill written for refarm is automatically available to
Pi users who install it, and vice versa. Invest in skill quality — the audience
is both ecosystems.

**No action needed** beyond ensuring skill file locations are consistent
(`~/.claude/plugins/` or equivalent per ecosystem).

---

## Layer 2: Shared memory schema (already interoperable)

Both Pi and refarm use `.project/` JSON files for session-to-session context:
- `decisions.json` — decisions made during development
- `handoff.json` — state for the next session
- `tasks.json` — current work items
- `requirements.json` — requirements in scope
- `verification.json` — test/check outcomes

A Pi session and a refarm session working on the same codebase naturally share
this context because it lives in the repository, not in the tool.

**No action needed.**

---

## Layer 3: WIT contracts (structurally interoperable, not yet wired)

### What Pi exposes

Pi agents built as WASM plugins import these WIT interfaces from the host:
- `agent-fs` — read/write/edit files (atomic)
- `agent-shell` — spawn subprocesses (policy-gated)
- `structured-io` — parse/write JSON/TOML/YAML with validation

### What refarm provides

Tractor's host bridge (`packages/tractor/src/host/agent_tools_bridge/`) implements
the same WIT interfaces natively in Rust:
- `AgentFsHost` — `read`, `write` (atomic), `edit` (diffy patch)
- `AgentShellHost` — `spawn` with timeout cap and argv enforcement
- `StructuredIoHost` — JSON/TOML/YAML parse + validate

The WIT package is `refarm:agent-tools@0.1.0` (defined in
`packages/agent-tools/wit/world.wit`). This is the same contract both sides
target.

**Consequence**: A WASM plugin built to use `agent-fs` and `agent-shell` (Pi
interface) runs on refarm's Tractor without modification, provided the WIT
package names and versions match.

**Current gap**: Pi uses `refarm:agent-tools@0.1.0` (same package); the exact
interface signatures need a diff to confirm binary compatibility. If they match,
pi-agent.wasm loads in Tractor without recompilation. If they diverge, there is
a compatibility shim to write.

**Action**: Run `wasm-tools component wit packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm`
and compare against `packages/agent-tools/wit/world.wit` to verify. This is a
2-minute check that should be done before claiming WIT interoperability.

---

## Layer 4: LLM provider protocol (interoperable via env vars)

Both Pi and refarm configure LLM providers via env vars:

| Env var | Pi | Refarm |
|---|---|---|
| `MODEL_PROVIDER` | ✅ | ✅ |
| `MODEL_ID` | ✅ | ✅ |
| `ANTHROPIC_API_KEY` | ✅ | ✅ |
| `MODEL_HISTORY_TURNS` | ✅ | ✅ (pi-agent) |
| `MODEL_TOOL_CALL_MAX_ITER` | ✅ | ✅ (pi-agent) |
| `MODEL_STREAM_RESPONSES` | ✅ | ✅ (pi-agent) |
| `MODEL_BUDGET_<PROVIDER>_USD` | ✅ | ✅ (pi-agent) |

A user who configures Pi's env vars gets the same behavior in refarm's pi-agent
without reconfiguration. `farmhand-start.sh` reads the same `.env` fallback.

**No action needed.**

---

## Layer 5: Effort / task protocol (refarm-specific, Pi-agnostic)

Refarm's task model (`effort-contract-v1`) is a higher-level protocol:
- `Effort` = set of `Task`s submitted as a unit
- Each `Task` has `pluginId`, `fn`, `args`
- Results stream via NDJSON

Pi does not use this protocol — Pi agents are invoked directly by the Pi host.
Refarm's protocol is the abstraction that allows multiple consumers (chat, web,
scripts) to share the same farmhand.

**Interoperability question**: can a Pi agent submit efforts to farmhand's HTTP
sidecar? Yes — `POST http://localhost:42001/efforts` accepts any HTTP client.
A Pi script or extension could submit a task to farmhand and follow the stream.

**This is a superpower**: Pi can delegate tasks to refarm plugins (running as
WASM inside Tractor) without any porting. The HTTP sidecar is the bridge.

**No action needed** — this works today.

---

## Migration path: Pi Extension → Refarm plugin

Pi Extensions are TypeScript packages that use Pi's extension API
(`beforeToolCall`, `afterToolCall`, hooks, etc.). They are not directly portable
to refarm because:

1. Pi extension API is host-specific (TypeScript, Pi runtime)
2. Refarm plugins are WIT components (WASM, any language)
3. The lifecycle hooks differ: Pi has `beforeToolCall`/`afterToolCall`; refarm
   has Scarecrow WIT observation (Steps 3+4, not yet implemented)

**Migration pattern**:

| Pi Extension does | Refarm equivalent |
|---|---|
| Reads/writes files via Pi tool hooks | `agent-fs` WIT imports in WASM plugin |
| Runs subprocesses | `agent-shell` WIT imports in WASM plugin |
| Hooks into tool calls | Scarecrow WIT observation (planned) |
| Manages state in Pi session | Tractor CRDT node storage |
| Reads extension config | `.refarm/config.json` (via `@refarm.dev/config`; root `refarm.config.json` is legacy-readable) |

**Complexity**: Low for data processing, computation, and API integration.
Medium for extensions that deeply hook into Pi's tool lifecycle (need Scarecrow).
High for extensions that depend on Pi-specific runtime guarantees (rare).

---

## Migration path: Refarm plugin → Pi Extension

Refarm plugins (WASM components targeting `refarm:agent-tools@0.1.0`) can be
exposed to Pi if Pi supports loading WASM components. Today, Pi's coding agent
is itself a WASM component (pi-agent); the question is whether Pi's runtime
(Tractor or Pi-specific) can load arbitrary WASM plugins.

**Current state**: Pi's runtime and refarm's Tractor share the same WIT contract.
If Pi uses the same wasmtime host, a refarm plugin loads in Pi without modification.
If Pi uses a different host, a thin adapter is needed.

**Action needed**: Confirm Pi's runtime architecture. If it's the same Tractor
(or compatible wasmtime host), migration is trivial — publish the WASM artifact
and add to Pi's plugin config.

---

## What we should NOT do

1. **Don't wrap Pi Extension API** in a compatibility shim for refarm. The right
   answer is WIT. A shim couples refarm to Pi's API evolution.

2. **Don't copy Pi's compaction thresholds** (50/68/72%). These are Pi-specific
   empirical values. Refarm should derive its own from actual usage.

3. **Don't assume binary WIT compatibility** without running the diff check
   (Layer 3 action above). One diverged interface version breaks everything silently.

4. **Don't build a Pi-to-refarm bridge daemon**. The HTTP sidecar is the bridge.
   Pi can call `POST /efforts` directly.

---

## Summary: what interoperates today vs. what needs work

| Layer | State today | Action needed |
|---|---|---|
| Skills (Markdown) | ✅ Fully interoperable | Curate and maintain in agents-lab |
| `.project/` schema | ✅ Shared protocol | Nothing |
| LLM provider env vars | ✅ Same convention | Nothing |
| WIT contracts | ✅ Structurally aligned | Run `wasm-tools` diff to confirm binary compat |
| HTTP effort submission | ✅ Pi can call farmhand today | Document the endpoint for Pi users |
| Pi Extension → refarm | ⏳ Needs Scarecrow (Steps 3+4) | Implement Barn Steps 3+4 |
| Refarm plugin → Pi | ❓ Depends on Pi's runtime | Confirm Pi's wasmtime host |
