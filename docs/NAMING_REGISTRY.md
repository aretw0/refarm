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
| **Tractor** | The Core Engine / Microkernel. Orchestrates all plugins. | Stable |
| **Homestead** | The primary user interface / Dashboard application. | Active |
| **Sower** | Data Seeder / Provisioner. Handles initial state and migrations. | Active |
| **Scarecrow** | System Auditor. Evaluates performance/A11y citizenship. | Active |
| **Heartwood** | The Security Kernel (WASM). Protects the Root of Trust. | Active |

## Plugins & Modules

| Name | Role | Status |
| :--- | :--- | :--- |
| **Herald (Arauto)** | In-app notification system and event announcer. | In Use |
| **Firefly** | Discovery and lightweight status indicators. | In Use |
| **Tractor-Bridge** | WIT interface between Tractor and Plugins. | Stable |
| **Courier** | Global Courier / Router. Rotes data between peers via local LAN or Relays. | Active |

## Potential Names (The "Pantry")

| Candidate | Thematic Connection | Potential Use |
| :--- | :--- | :--- |
| **Radio** | Two-way communication, broadcasting, tuning into frequencies. | Sync / Transport / PubSub |
| **Silo** | Massive storage for harvested crops. | Archival Storage / Data Lake |
| **Windmill** | Transforms raw forces (Graph) into useful energy (Web/Builds). | Compiler / Builder |
| **Pigeon** | Reliable, old-school message carrier. | Fallback Transport |
| **Well** | The source of truth for the local environment. | Storage Facade |
| **Root** | The deep connection to the underlying OS/Filesystem. | Low-level Adapter |

---

*Note: Always consult this registry before naming a new package to avoid conflicts and maintain the Refarm "Aura".*
