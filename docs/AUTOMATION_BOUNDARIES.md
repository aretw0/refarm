# Refarm: Automation Boundaries & Scaffolding

This document defines the limits of what we can automate and what remains a manual "Sovereign Choice" for the user.

## The "Zero-Manual" Philosophy
The goal is that once a user provides **Initial Intent** (Tokens), Refarm manages everything else as Code/Config.

### 1. GitHub (The Repository Herd)

| Action | Status | Method |
|--------|--------|--------|
| Create GitHub Account | **MANUAL** | User must own their identity. |
| Generate PAT / Installed App | **MANUAL** | User must grant initial access. |
| Create Migration/Backup Repos | **AUTOMATED** | `Windmill` via GitHub API. |
| Set Repository Secrets | **AUTOMATED** | `Windmill` / `Silo` via API. |
| Organization Setup | **AUTOMATED** | `Fence` / `Sower` via API. |

### 2. Cloudflare (The DNS Field)

| Action | Status | Method |
|--------|--------|--------|
| Create Cloudflare Account | **MANUAL** | User ownership. |
| Add Domain to Account | **MANUAL** | Requires external change. |
| Generate Zone API Token | **MANUAL** | Standard security procedure. |
| Create DNS Records | **AUTOMATED** | `Windmill` via Cloudflare API. |
| Configure WAF/Workers | **AUTOMATED** | `Windmill` via API. |

---

## The "Sower" CLI (Scaffolding & Onboarding)

The CLI acts as the entry point for the "Farm". It converts user intent into a living repository.

### Commands
1. **`refarm init`**: Scaffolds a new project from a template.
2. **`refarm sow`**: Interactive prompt to collect tokens (Silo) and verify connections.
3. **`refarm harvest`**: Runs verification/audits across the graph.
4. **`refarm migrate`**: Triggers the Emergency Gate (Escape Hatch) manually.

## Implementation Path

1. **`@refarm.dev/cli`**: Lightweight entry point (oclif or commander).
2. **`Sower` Logic Expansion**: Move scaffolding logic into the Sower core so it can be shared between the Browser (Plugin) and CLI.
3. **Documentation-as-Automation**: Generate a `SETUP_GUIDE.md` dynamically based on the current config.
