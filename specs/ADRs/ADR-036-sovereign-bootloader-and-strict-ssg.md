# ADR-036: Sovereign Bootloader and Strict SSG Constraint

## Status
Accepted

## Context
Refarm aims to provide a Personal Operating System where all user data is owned locally and offline-first. The user interface (`apps/homestead`) is currently built using Astro.

As the project grows, there is a natural temptation to leverage modern meta-framework features like Server-Side Rendering (SSR) to handle complex routing, data fetching, or dynamic HTML generation.

However, rendering UI components on a centralized server (SSR) fundamentally conflicts with the Sovereign Graph architecture. If the UI requires a cloud server to render, the user loses the ability to easily fork, run locally, or deploy the application to purely static peer-to-peer networks (e.g., IPFS) or cheap static hosting (e.g., GitHub Pages).

Furthermore, the core tenet of the Tractor microkernel is that **every non-canonical screen must come from the user's graph via a plugin**. The host application should not dictate the visual boundaries; it should only facilitate them.

## Decision
1. **The Sovereign Bootloader Architecture:** The `Homestead` app must act exactly like a bare-metal OS bootloader. It is an empty shell that initializes the Tractor engine and the user's Sovereign Graph. It must not hardcode complex, proprietary navigation structures that cannot be overridden by user plugins.
2. **Strict Static Site Generation (SSG) / Single Page Application (SPA):** We establish a strict constraint that `Homestead` and any future Web GUI must remain 100% compile-time static (SSG) or client-side rendered (SPA).
3. **No UI-rendering SSR:** We explicitly prohibit transforming the Astro application into an SSR-rendered monolith.
4. **Targeted Edge Connectivity:** We anticipate hitting the natural limits of the static architecture (e.g., when needing to receive Webhooks while the user's node is offline). When this threshold is reached, we will adopt Edge Workers (e.g., Cloudflare Workers) **exclusively as asynchronous transit layers**. Workers will act as mailboxes or Key-Value relays, queueing data for the Sovereign instance to poll and process upon "wake up." The Edge must never generate the HTML/UI.

## Consequences

### Positive
* **Ultimate Portability:** The entire application can be deployed to absolutely any static host (GitHub Pages, S3, IPFS) without server configuration.
* **Architectural Purity:** The line between the "Host System" (Tractor) and the "Cloud Transport" remains clear. The cloud is relegated to a dumb pipe/storage mechanism.
* **Resilience:** The system degrades gracefully. If the "Edge Mailbox" goes down, the localized graph and UI still work perfectly.

### Negative
* **Increased Initial Payload:** As an SPA/SSG, the initial JavaScript bundle may be larger than a carefully chunked SSR application.
* **Complex Background Sync:** Handling asynchronous events (webhooks, notifications) when the browser tab is closed requires sophisticated synchronization routines once the app restarts, rather than processing them instantly on an active server.
