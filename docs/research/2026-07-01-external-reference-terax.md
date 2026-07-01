# Research: external reference - Terax (2026-07-01)

> Reference/influence note. Terax is a lesson source for terminal-first agentic
> workspaces, host-owned OS capabilities, and structured terminal/agent signals.
> This is not a dependency decision and not a reason to turn Refarm into a
> desktop IDE clone.

## Source

- Repository: <https://github.com/crynta/terax-ai>
- README: <https://github.com/crynta/terax-ai/blob/main/README.md>
- Architecture/memory note: <https://github.com/crynta/terax-ai/blob/main/TERAX.md>
- Roadmap: <https://github.com/crynta/terax-ai/blob/main/ROADMAP.md>

## What Terax is

Terax positions itself as a lightweight terminal-first agentic development
environment. Its README describes a Tauri 2 + Rust host with a React UI,
native PTY backend, WebGL terminal, code editor, file explorer, source control,
web preview, BYOK/local model support, custom agents, plan mode, and approval
gates for agent tools. Its roadmap is explicit about scope: terminal-first,
not a full IDE replacement, not a browser, and not a general workspace.

The strongest lesson for Refarm is **surface discipline**: Terax is broad enough
to be useful, but it repeatedly draws product boundaries around the terminal as
the primary work surface. For Refarm, that suggests growing remote workspace and
agent-driver surfaces through contracts and capability seams, not by letting
every app become the whole platform.

## Refarm assimilation map

| Terax lesson | Refarm home | Boundary |
|---|---|---|
| Terminal-first ADE, not full IDE | `interaction-driver`, `process-handoff`, remote workspace control plane | learn posture; do not clone product |
| Rust/Tauri host owns OS access; webview uses commands | Tractor host boundary, WIT capabilities, `dispatch-surface`, ADR-074/078 | host/core split, not app-local privilege |
| PTY cwd/command boundaries via OSC 7 / OSC 133 | `process-handoff`, `stream-contract-v1`, future terminal-observation contract | structured terminal events over raw prompt parsing |
| Agent status markers via OSC 777 hooks | `session-contract-v1`, runtime events, `tool-observation:v1` direction | agent-neutral signal contract, not Terax-specific hooks |
| Persistent terminals/tabs hidden rather than remounted | dispatch surfaces, app shell lifecycle, resource ceilings | lifecycle invariants before richer UI |
| Ring-buffered dormant terminal output | command observation, session artifacts, RTK-inspired raw evidence recovery | bounded evidence, not unlimited logs |
| BYOK/local providers and OS keychain | `silo`, identity/credentials, provider policy | no keys in localStorage or app settings |
| AI edit diffs accepted/rejected per hunk | artifact/edit proposal contracts, verification-as-completion | user approval as structured artifact, not freeform chat |
| WSL as first-class workspace environment | remote workspace / environment node direction | model environments explicitly; do not hide them as shell strings |
| `TERAX.md` as project memory + architecture doc | `.project/handoff.json`, AGENTS.md, reference-driver docs | durable context belongs in project-owned files |

## Immediate implications

1. **Terminal observation deserves a named primitive.** RTK pushed us toward
   `tool-observation:v1` / `command-observation:v1`; Terax adds the terminal
   side: cwd changes, command start/end, exit code, foreground job state, agent
   status, and bounded output evidence should become structured events instead
   of prompt scraping.

2. **Remote workspace needs environment identity.** Terax treats Local vs WSL as
   different workspace environments. Refarm's multi-machine/Tailscale horizon
   should do the same: a node/environment is not just a cwd string; it has host,
   transport, shell, policy, credentials, and resource ceilings.

3. **A useful workbench can stay product-narrow.** Terax is not trying to be a
   full IDE or browser. Refarm's `apps/dev`, future site/docs, vault-seed, and
   agents-lab should keep their own product boundaries while importing Refarm
   contracts.

4. **Agent visibility should be signal-driven.** Terax uses explicit terminal
   markers for coding agents rather than inferring state from noisy TUI output.
   Refarm should prefer explicit lifecycle events from runtime tools, hooks, or
   terminal integration over heuristics.

5. **Host privilege belongs behind one boundary.** Terax's webview delegates OS
   access to Rust commands. Refarm already aims at capability-gated hosts; this
   reinforces keeping filesystem/process/network/git/secrets behind host-owned
   policies and evidence.

## Candidate slices

1. **Spec-only first pass:** add a `terminal-observation:v1` or extend the
   `tool-observation:v1` candidate with PTY-specific events: cwd, command start,
   command end, exit code, agent status, foreground job, and bounded output
   artifact pointer.

2. **Process handoff proof:** make one local command path emit a compact
   terminal/process event envelope without changing execution behavior.

3. **Environment node proof:** model `local`, `container`, `remote`, and `wsl`
   as explicit environment descriptors, even if only `local/container` are
   implemented first.

4. **Edit proposal proof:** connect agent-generated edits to a structured
   artifact that can be accepted/rejected in hunks before write execution.

## Non-goals

- No Terax dependency for v0.1.0.
- No attempt to clone Terax as an app.
- No desktop-first rewrite of Refarm.
- No broad IDE feature expansion before package publication and runtime proofs.
- No terminal scraping as a substitute for explicit process/session events.

## Relationship to current roadmap

- **Reference driver:** Terax reinforces the local daily-driver nucleus:
  terminal/session/process/git/agent signals must be observable and recoverable.
- **ADR-074 remote workspace:** environment identity and structured host access
  are prerequisites for controlling other machines sanely.
- **ADR-078 resource ceilings:** persistent terminals, background jobs, and
  renderer/resource slots need explicit limits.
- **RTK observation membrane:** RTK covers command-output mediation; Terax adds
  terminal lifecycle and agent-status signals.
- **Public site/docs split:** Terax's product focus supports our current stance:
  keep `apps/dev` a dogfood workbench and create a separate public docs/site
  surface when needed.

Verdict: assimilate Terax as a reference for terminal-first workbench posture,
structured terminal/agent observation, host-owned OS access, and explicit
environment identity. The first Refarm artifact should be a spec/contract and
small process-handoff proof, not a new app.
