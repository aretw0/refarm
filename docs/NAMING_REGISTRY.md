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

---

*Note: Always consult this registry before naming a new package to avoid conflicts and maintain the Refarm "Aura".*
