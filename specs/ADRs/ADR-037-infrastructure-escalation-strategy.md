# ADR-037: Infrastructure Escalation Strategy (Servers and Edge)

## Status
Accepted

## Context
Refarm is designed with a strict "Offline-First" and "Sovereign Bootloader" architecture (see ADR-002 and ADR-036). The core system runs entirely in the user's browser, persisting to local SQLite/OPFS and synchronizing peer-to-peer (P2P) via WebRTC.

However, pure P2P and offline architectures face inherent physical limitations:
1. **The "Offline Friend" Problem:** If User A wants to sync data with User B, but User B's device is turned off, the sync cannot occur unless there is an always-online intermediary.
2. **Asynchronous Webhooks:** If an external system (e.g., a payment provider like Stripe) sends a webhook, the user's browser must be open to receive it.
3. **Bandwidth/Computation Limits:** Heavy AI inference or massive data aggregations may eventually exceed browser capabilities.

The temptation is to immediately build a monolithic central server. This violates the Radical Ejection Right and centralizes control. We need a formalized, phased strategy for "dipping our toes into servers" that preserves user sovereignty while solving practical UX hurdles.

## Decision: The Infrastructure Escalation Path
We will adopt a phased escalation strategy for server infrastructure. Servers are treated as "dumb relays" or "assistants", never as absolute authorities over the data.

### Phase 1: Pure Local & Direct P2P (Current State)
- **Architecture:** SQLite (OPFS) + CRDTs + WebRTC/Nostr discovery.
- **Rules:** The system must function 100% locally. Collaboration requires both parties to be online simultaneously.

### Phase 2: Asynchronous Mailboxes (The "Dumb" Cloud)
To solve the "Offline Friend" and webhook problems, we will introduce Edge Workers (e.g., Cloudflare Workers) and Key-Value (KV) stores.
- **Architecture:** Cloudflare Workers + KV.
- **Rules:**
  1. The Cloud is **only** a mailbox. It receives encrypted CRDT updates or raw webhook payloads and stores them.
  2. It performs **no domain logic** and **no HTML rendering**.
  3. When the user's Refarm instance boots up, it polls its mailbox, downloads the encrypted payloads, and processes them locally via the Tractor microkernel.
  4. Users should be able to run their own "Mailbox Node" (e.g., on a Raspberry Pi) using the same Tractor SDK, bypassing corporate cloud entirely if they choose.

### Phase 3: Sovereign Always-On Nodes (Opt-In Hosting)
For users who need constant uptime without relying on third-party SaaS "mailboxes", they can deploy a headless instance of the Tractor kernel.
- **Architecture:** Node.js/Deno/Bun running the `@refarm.dev/tractor` package on a VPS, Raspberry Pi, or Homelab.
- **Rules:** This is just another peer in the CRDT swarm, but it runs 24/7. It acts as a reliable backup and a constant seed for the user's graph.

### Phase 4: Sovereign Backend Framework (API Layer)
Refarm is not just a consumer application; it provides an SDK mechanism. To expose the power of the Sovereign Graph to external systems, users can deploy an API layer.
- **Architecture:** An Astro backend (SSR/Serverless) acting as an API gateway.
- **Rules:** The backend framework uses the `@refarm.dev/tractor` engine headless. It exposes REST/GraphQL/RPC endpoints directly from the user's graph. It can be deployed privately (to serve only the user's secure devices/applications) or publicly (to act as a public data publisher). It keeps the Tractor kernel strictly clean of routing/HTTP logic which is handled entirely by Astro.

### Phase 5: Targeted Server-Side Rendering (SSR) [Strictly Limited]
If, and only if, a specific feature requires SEO indexing (e.g., public profile pages on `@refarm.social`), we may introduce SSR.
- **Architecture:** Edge-rendered Astro endpoints.
- **Rules:** SSR is applied **only** to specific public-facing routes, not the core Studio/Desktop application. The Homestead IDE remains a pure SSG/SPA Bootloader.

## Consequences

### Positive
- **Preserves Sovereignty:** Users are never locked out of their data if the "Cloud Mailbox" goes down. The source of truth remains on their devices.
- **Scalable:** Cloudflare Workers/KV are incredibly cheap and scalable, perfect for dumb message queuing.
- **Friend-to-Friend Sharing:** An always-on node or cloud mailbox allows seamless async sharing between friends across timezones.
- **Full Spectrum Stack:** Offering a Sovereign API framework allows power users to treat their Graph as a headless CMS or unified data backbone for third-party scripts.

### Negative
- **Architectural Complexity:** Syncing state between a local CRDT, a cloud mailbox, and a friend's offline device introduces challenging distributed systems edge cases.
- **Latency:** Polling a mailbox is slower than direct P2P connections or server-authoritative websockets.
