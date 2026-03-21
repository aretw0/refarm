# Groundwork for Long-Term Convergence

> "The transition from a Fertile Soil (Data OS) to an Autonomous Sovereign Agent (Vision 2026)."

This document outlines the essential "groundwork" required to bridge the current v0.1.0 stability phase with the long-term vision of agentic sovereignty. These are foundational tasks that, while atomic, open the doors for the project's ultimate convergence.

---

## 🏛 The Five Pillars of Convergence

### 1. Universal Inference WIT (`ai-inference-contract-v1`)
In the Refarm vision, AI is not an external API but a **kernel-level capability** (WASI primitive).
- **Goal**: Standardize how any plugin requests completion or embeddings from the Tractor host.
- **Impact**: Enables a "Local-First AI" ecosystem where plugins are intelligent by default, without managing their own models or API keys.

### 2. Resilient Schema Evolution (Migration Tooling)
Sovereignty means your data remains readable and upgradable over decades, across multiple devices and versions.
- **Goal**: Implement robust, versioned schema migration for `storage-sqlite` and Loro CRDT materialized views.
- **Impact**: Prevents "bit rot" and ensures that the Sovereign Graph can evolve without breaking old user data.

### 3. Cognitive Map Maturation (TEM WASM Migration)
The **Tolman-Eichenbaum Machine (TEM)** is the system's "hipocampus," mapping the user's relational topology.
- **Goal**: Migrate the TypeScript TEM core to a native WASM plugin with integrated trained weights.
- **Impact**: Provides the mathematical basis for "Active Inference" (novelty detection), allowing the Agent to understand what is "normal" versus "unexpected" in the user's graph.

### 4. Cross-Runtime Parity (TS ↔ Rust)
Refarm now has dual hearts: the TypeScript Tractor (Browser/Node) and the Rust Tractor (Native/Edge).
- **Goal**: Achieve 100% test parity and shared SQLite schemas between both runtimes.
- **Impact**: Ensures "Seamless Sovereignty" where a user can switch between a browser UI and a headless background daemon without data or behavioral drift.

### 5. Sovereign Observability (`scarecrow`)
As the ecosystem grows, the system must protect itself from "bad actors" or poorly optimized plugins.
- **Goal**: Flesh out the `scarecrow` monitoring system to enforce "Plugin Citizenship" (resource quotas, a11y scores, update velocity).
- **Impact**: Maintains a healthy "Fertile Soil" where autonomy doesn't lead to chaos or performance degradation.

---

## 🚀 Immediate Action: Schema Migration (Pillar 2)

We are starting with **Pillar 2** because it is the most foundational for long-term data safety. 

### Strategy: SDD → BDD → TDD → DDD

1. **SDD (Spec)**: Define a versioned migration strategy for `storage-sqlite` that uses named/versioned scripts instead of simple array indices.
2. **BDD (Behavior)**: Write integration tests in `packages/storage-sqlite` that simulate upgrading a "Legacy v0" database to "Schema v1".
3. **TDD (Test)**: Implement the refined `runMigrations` utility with unit tests for edge cases (interrupted migrations, rollback-like behavior).
4. **DDD (Develop)**: Write domain code that green all tests.

---

## 🧠 Relationship to Vision 2026

By completing this groundwork, we move the Refarm project from a static database architecture to a dynamic, self-healing, and intelligent system capable of hosting the **Autonomous Sovereign Agent**.

- **v0.1.0**: Stable Primitives (The Soil)
- **v0.2.0**: Discoverable Capabilities (The Growth)
- **Vision 2026**: Agentic Autonomy (The Harvest)
