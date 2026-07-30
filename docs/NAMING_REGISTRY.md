# Refarm Naming Registry

This document tracks the thematic names used for core components and plugins within the Refarm ecosystem. The naming convention follows a **Rural / Protective / Sovereign Estate** aesthetic.

## Domain Strategy & Topology

Refarm is a unified architecture that manifests as distinct sub-ecosystems depending on the "lens" or domain used to access it. All domains run the same Tractor core but curate different plugins and identity contexts.

| Domain | Role & Persona | Key Components |
| :--- | :--- | :--- |
| **`refarm.dev`** | **The Factory Floor / Core Engine**. The developer portal, WIT definitions, and the Tractor microkernel. | Tractor, Courier, Heartwood, SDKs, Graph Schemas |
| **`refarm.me`** | **The Sovereign Identity**. The personal, private "Second Brain". Focuses on E2EE, Zero-Knowledge, and personal agency. | Homestead, Private Storage, Keys / Recovery |
| **`refarm.social`** | **The Village**. The networked, public-facing facet. Digital Gardens, P2P CRDT sync, and federated communication. | Social Plugins, Public Feeds |

## Core Components

| Name | Role | Status |
| :--- | :--- | :--- |
| **Root** | Runtime environment detection primitives. Answers "where are we running?" (container, WSL, CI, TTY). | Active |
| **Tractor** | The Core Engine / Microkernel. Orchestrates all plugins. | Stable |
| **Homestead** | The primary user interface / Dashboard application. | Active |
| **Sower** | Data Seeder / Provisioner. Handles initial state and migrations. | Active |
| **Scarecrow** | System Auditor. Evaluates performance/A11y citizenship. | Active |
| **Heartwood** | The Security Kernel (WASM). Protects the Root of Trust. | Active |
| **Silo** | Context and Secret Provisioner. Handles tokens and identity metadata. | Active |
| **Windmill** | Infrastructure Provider Bridge. Handles reconciliation of DNS and Repository state. | Active |

## Plugins & Modules

| Name | Role | Status |
| :--- | :--- | :--- |
| **Herald (Arauto)** | In-app notification system and event announcer. | In Use |
| **Firefly** | Discovery and lightweight status indicators. | In Use |
| **Tractor-Bridge** | WIT interface between Tractor and Plugins. | Stable |
| **Courier** | Global Courier / Router. Routes data between peers via local LAN or Relays. | Active |
| **Barn (O Celeiro)** | Machinery Manager. Handles plugin lifecycle, OPFS cache, and inventory. | Planned |
| **Surveyor (O Agrimensor)** | Graph Mapper. Visualizes and navigates the Sovereign Graph. | Planned |
| **Creek (O Riacho)** | Telemetry Stream. Real-time monitor for system pulses and events. | Planned |
| **Thresher** | Compatibility and Integrity Auditor. | Active |

## Potential Names (The "Pantry")

| Candidate | Thematic Connection | Potential Use |
| :--- | :--- | :--- |
| **Radio** | Two-way communication, broadcasting, tuning into frequencies. | Sync / Transport / PubSub |
| **Pigeon** | Reliable, old-school message carrier. | Fallback Transport |
| **Well** | The source of truth for the local environment. | Storage Facade |

## Environment Variable Prefixes

Two prefixes exist, and the split is deliberate. It had never been written down, which made it
guesswork — this section is the answer.

| Prefix | Answers | Who sets it | Count |
| :--- | :--- | :--- | :--- |
| **`REFARM_*`** | *How does this node behave?* Runtime, paths, policy, hosts, feature switches. | The operator of the machine refarm runs on. | ~172 |
| **`FARM_*`** | *How does a device join the farm?* Host, ports, beacon, name, model, token. | A device connecting **to** a farm — a phone, a Termux session, another node. | ~11 |

`FARM_*` is the vocabulary of `farm-client` (deliberately zero-dependency, so it can run on a device
that has almost nothing) and `farmhand`. `REFARM_*` is the vocabulary of the node itself.

`packages/tractor/src/sidecar/auth.rs` states the same layering for credentials: *the tailnet
authenticates the device to the **network**; the token authenticates it to the **farm***. So
`FARM_TOKEN` — the per-device credential minted by `refarm auth enroll` and carried by a joining
device — belongs to the `FARM_*` family, not to `REFARM_*`, even though `REFARM_*` is far more
common.

**The rule:** if a *device joining a farm* needs it, `FARM_*`. If the *node* needs it, `REFARM_*`.
When in doubt, ask who has to type it: the operator configuring this machine, or the device dialing
in.

Do not add aliases across the two families. An alias makes both names correct, which is how a
convention rots into two conventions.

## `ok` semantics

`ok` is the most-read field in every JSON envelope this repo emits, and its meaning had never been
written down. Six commands guessed differently, which is how `refarm runtime status --json` came to
answer `ok:false` for a runtime that was merely not running. This section is the answer.

**The rule:**

> **`ok` means "the command did its job", not "the answer was yes."**

A status command that successfully reports that something is **down** did its job: `ok: true`,
exit 0, and the subject's state in its **own field** (`ready: false`, `running: false`,
`status: "unresponsive"`).

`ok: false` is reserved for the **command** failing — bad input, an unreachable dependency it
needed, a refusal — and then **the exit code must be non-zero.** `ok` and the exit code always
agree; an envelope that says `ok:false` while exiting 0 is a lie to the shell, and one that exits
non-zero with no envelope is a lie to a `--json` consumer.

**Why, so it is applied rather than memorised:** if `ok` were the verdict on the *subject*, a
script running under `set -e` would die merely for **asking** how things are. `git status` on a
dirty tree exits 0 for exactly this reason — the question was answered, and the answer is the
output, not the exit code.

**How to tell which you have:** ask what the command's job *is*.

| The command is… | Its job is… | On a bad subject |
| :--- | :--- | :--- |
| a **report** (`runtime status`, `guide`, `agent doctor`) | producing an accurate answer | `ok: true`, exit 0, state in its own field |
| an **act** (`runtime start`, `config set`, `auth enroll`) | changing the world | `ok: false`, non-zero exit |

The same payload builder can serve both — `buildRuntimeJsonPayload` decides per `operation`, so
`runtime status` reports and `runtime start` acts, out of one shape.

**Do not "fix" the one exception:** `refarm intention check` **exits 2 when the intention is not
armed.** That is deliberate, and it is a *different contract from a status report* — `intention
check` exists to be a scriptable **gate**, so its exit code is its whole output, the way `test(1)`
or `grep -q` work. A gate is asked to *decide*, not to *describe*. Leave it alone, and do not
generalise from it: a command is a gate only when it was designed as one and says so.

Enforced by `apps/refarm/test/architecture/cli-refusal-conformance.test.ts`, which probes every
registered command and fails on `ok:false` with exit 0 — among other things.

## `findRepoRoot` resolves from the module, not from `cwd`

**Sandboxing `cwd` does not isolate this CLI.** `findRepoRoot()`
(`apps/refarm/src/commands/session-launch.ts`) walks up from **its own module location**, so a
process that has `chdir`-ed into a throwaway directory still resolves the **real** repository — and
therefore the operator's real, live `.refarm/`.

This was found by the refusal-conformance harness's filesystem write guard, which caught five
commands reaching outside a sandboxed cwd for real operator state: `discover announce`
(`fs.rmSync` on the real `farm-announce.pid`), `runtime start` / `ensure` / `restart`
(`fs.mkdirSync` on the real `.refarm`), and `runtime stop` — which read the **real** pidfile and
called `process.kill()` on that pid. Only a `process.kill` guard stood between a test probe and
stopping the operator's live runtime.

**So:** a test, tool or agent that needs isolation from operator state must guard the **effect**
(wrap `fs` writes, `child_process`, sockets, `process.kill`), not merely the working directory.
Assuming `chdir` is containment is the mistake this note exists to prevent.

---

*Note: Always consult this registry before naming a new package to avoid conflicts and maintain the Refarm "Aura".*
