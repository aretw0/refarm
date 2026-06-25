# Silo Collection Contract (Item 4c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a namespaced credential-**collection** front door to `@refarm.dev/silo` (`CredentialProvider` + `collectAndStore`), backed by a namespaced secret store, and re-home `apps/refarm`'s credential providers onto it — keeping secret classes separate.

**Architecture:** `silo` already stores a **flat** token map in `~/.refarm/identity.json` (`{ tokens, updatedAt }`) via `SiloCore.saveTokens/loadTokens`. This plan adds a **namespaced** secret store (`secrets[namespace][id]`) alongside `tokens` (non-breaking), then a `collect.js` front door. The app's concrete OAuth/prompt flows stay in `apps/refarm`.

**Tech Stack:** `@refarm.dev/silo` is a **JavaScript package with JSDoc types** (`src/index.js`, `src/key-manager.js`; tests are `.ts` via vitest; build is `tsc`). Match that convention: source `collect.js` + JSDoc; test `collect.test.ts`. **Do not introduce a `.ts` source file** — mirror `index.js`.

**Spec:** `specs/features/2026-06-25-silo-collection-contract.md`

## Global Constraints

- **Storage shape (existing):** `SiloCore.storagePath` = `~/.refarm/identity.json`, JSON `{ tokens, secrets?, updatedAt }`. The constructor accepts `config.storagePath` — tests use a temp file.
- **Namespaces are kept separate** — never merge secret classes. Reserved set: `model`, `runtime`, `channel`, `publishing`.
- **`prompt-contract-v1` is type-only** here (JSDoc `OperatorChannel`) → a **devDependency**, no runtime import, so `silo` stays runtime-acyclic.
- **Test:** `pnpm -C packages/silo run test`.

---

### Task 1: Namespaced secret store on `SiloCore` (TDD)

**Files:**
- Modify: `packages/silo/src/index.js` (add `saveSecret` / `loadSecret`)
- Create: `packages/silo/src/secrets.test.ts`

**Interfaces:**
- Produces: `SiloCore.saveSecret(namespace, id, value): Promise<{status,namespace,id,path}>`, `SiloCore.loadSecret(namespace, id): Promise<string|undefined>`.

- [x] **Step 1: Write the failing test** — `src/secrets.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SiloCore } from "./index.js";

function tmpCore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "silo-"));
  return new SiloCore({ storagePath: path.join(dir, "identity.json") });
}

describe("SiloCore namespaced secrets", () => {
  it("saves and loads a secret under a namespace", async () => {
    const core = tmpCore();
    await core.saveSecret("channel", "telegram", "tok-123");
    expect(await core.loadSecret("channel", "telegram")).toBe("tok-123");
  });

  it("keeps namespaces separate and does not touch tokens", async () => {
    const core = tmpCore();
    await core.saveTokens({ githubToken: "g" });
    await core.saveSecret("model", "openai", "m");
    await core.saveSecret("runtime", "openai", "r");
    expect(await core.loadSecret("model", "openai")).toBe("m");
    expect(await core.loadSecret("runtime", "openai")).toBe("r");
    expect((await core.loadTokens()).githubToken).toBe("g");
  });

  it("returns undefined for a missing secret", async () => {
    expect(await tmpCore().loadSecret("channel", "nope")).toBeUndefined();
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/silo run test`
Expected: FAIL — `core.saveSecret is not a function`.

- [x] **Step 3: Add `saveSecret`/`loadSecret` to `SiloCore`** in `src/index.js` (after `loadTokens`, mirroring its file handling)

```js
    /**
     * Save a secret under a namespace, separate from the flat token map.
     * @param {string} namespace
     * @param {string} id
     * @param {string} value
     */
    async saveSecret(namespace, id, value) {
        this._ensureStorage();
        let current = {};
        if (existsSync(this.storagePath)) {
            current = JSON.parse(readFileSync(this.storagePath, "utf-8"));
        }
        current.secrets = current.secrets || {};
        current.secrets[namespace] = current.secrets[namespace] || {};
        current.secrets[namespace][id] = value;
        current.updatedAt = new Date().toISOString();
        writeFileSync(this.storagePath, JSON.stringify(current, null, 2));
        return { status: "success", namespace, id, path: this.storagePath };
    }

    /**
     * Load a namespaced secret.
     * @param {string} namespace
     * @param {string} id
     * @returns {Promise<string|undefined>}
     */
    async loadSecret(namespace, id) {
        if (!existsSync(this.storagePath)) return undefined;
        try {
            const data = JSON.parse(readFileSync(this.storagePath, "utf-8"));
            return data.secrets?.[namespace]?.[id];
        } catch (e) {
            console.error(`[Silo] Failed to load secret: ${e.message}`);
            return undefined;
        }
    }
```

- [x] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/silo run test`
Expected: PASS — secrets store/load + isolation + missing-secret tests green.

- [x] **Step 5: Commit**

```bash
git add packages/silo/src/index.js packages/silo/src/secrets.test.ts
git commit -m "feat(silo): namespaced secret store (saveSecret/loadSecret) alongside flat tokens"
```

---

### Task 2: Collection front door `collect.js` (TDD)

**Files:**
- Create: `packages/silo/src/collect.js`
- Create: `packages/silo/src/collect.test.ts`
- Modify: `packages/silo/src/index.js` (re-export `collectAndStore`)

**Interfaces:**
- Consumes: `SiloCore.saveSecret`.
- Produces: JSDoc typedefs `CollectContext`, `CredentialProvider`, `SiloCollectResult`; `collectAndStore(provider, ctx, core?): Promise<SiloCollectResult>`.

- [x] **Step 1: Write the failing test** — `src/collect.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SiloCore } from "./index.js";
import { collectAndStore } from "./collect.js";

function tmpCore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "silo-"));
  return new SiloCore({ storagePath: path.join(dir, "identity.json") });
}

describe("silo collectAndStore", () => {
  it("collects via the provider and stores under its namespace", async () => {
    const core = tmpCore();
    const provider = {
      id: "telegram", label: "Telegram", namespace: "channel",
      collect: async () => "tok-123",
    };
    const r = await collectAndStore(provider, { tryOpenUrl() {} }, core);
    expect(r).toEqual({ id: "telegram", namespace: "channel", stored: true });
    expect(await core.loadSecret("channel", "telegram")).toBe("tok-123");
  });

  it("routes different providers to different namespaces", async () => {
    const core = tmpCore();
    await collectAndStore({ id: "k", label: "M", namespace: "model", collect: async () => "m" }, { tryOpenUrl() {} }, core);
    await collectAndStore({ id: "k", label: "R", namespace: "runtime", collect: async () => "r" }, { tryOpenUrl() {} }, core);
    expect(await core.loadSecret("model", "k")).toBe("m");
    expect(await core.loadSecret("runtime", "k")).toBe("r");
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/silo run test`
Expected: FAIL — `./collect.js` does not exist.

- [x] **Step 3: Create `src/collect.js`** (JS + JSDoc, matching `index.js` style)

```js
import { SiloCore } from "./index.js";

/**
 * @typedef {Object} CollectContext
 * @property {(url: string) => void} tryOpenUrl
 * @property {import("@refarm.dev/prompt-contract-v1").OperatorChannel} [operator]
 */

/**
 * @typedef {Object} CredentialProvider
 * @property {string} id
 * @property {string} label
 * @property {string} namespace  Reserved set: model | runtime | channel | publishing (consumers may extend).
 * @property {(ctx: CollectContext) => Promise<string>} collect
 */

/**
 * @typedef {Object} SiloCollectResult
 * @property {string} id
 * @property {string} namespace
 * @property {boolean} stored
 */

/**
 * Collect a secret via the provider and persist it into silo under provider.namespace.
 * @param {CredentialProvider} provider
 * @param {CollectContext} ctx
 * @param {SiloCore} [core]
 * @returns {Promise<SiloCollectResult>}
 */
export async function collectAndStore(provider, ctx, core = new SiloCore()) {
  const value = await provider.collect(ctx);
  await core.saveSecret(provider.namespace, provider.id, value);
  return { id: provider.id, namespace: provider.namespace, stored: true };
}
```

- [x] **Step 4: Re-export from `src/index.js`** (add near the other exports)

```js
export { collectAndStore } from "./collect.js";
```

- [x] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/silo run test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/silo/src/collect.js packages/silo/src/collect.test.ts packages/silo/src/index.js
git commit -m "feat(silo): namespaced credential collection front door (collectAndStore)"
```

---

### Task 3: Type-only `prompt-contract-v1` dep + acyclic check

**Files:**
- Modify: `packages/silo/package.json` (devDependency)

- [x] **Step 1: Add the type-only dependency** to `packages/silo/package.json` `devDependencies`

```jsonc
"@refarm.dev/prompt-contract-v1": "workspace:*"
```

(Type-only via JSDoc `import(...)` — no runtime import, so it stays a devDependency and introduces no runtime cycle.)

- [x] **Step 2: Install + verify build order stays acyclic**

Run: `pnpm install && pnpm run task:build-order:check`
Expected: PASS — no cycle introduced.

- [x] **Step 3: Type-check the JSDoc**

Run: `pnpm -C packages/silo run build`
Expected: PASS — the `OperatorChannel` JSDoc import resolves through `tsc`.

- [x] **Step 4: Commit**

```bash
git add packages/silo/package.json
git commit -m "chore(silo): type-only prompt-contract-v1 dep for CollectContext"
```

---

### Task 4: Re-home `apps/refarm` credential providers

**Files:**
- Modify: `apps/refarm/src/credentials/types.ts` (re-export from `@refarm.dev/silo`)
- Modify: `apps/refarm/src/credentials/{github,cloudflare,model}.ts` (add `namespace`)

- [x] **Step 1: Make `types.ts` a thin re-export** (single source of truth, minimal churn)

```ts
export type { CredentialProvider, CollectContext } from "@refarm.dev/silo";
```

(Remove the local interface bodies; keep this file so existing importers keep working. The `namespace` field now comes from the silo contract — every provider must set it, which the next step does.)

- [x] **Step 2: Add `namespace` to each provider** — set the secret class:
  - `github.ts` → `readonly namespace = "runtime";`
  - `cloudflare.ts` → `readonly namespace = "runtime";`
  - `model.ts` → `readonly namespace = "model";`

  Where a provider previously persisted a collected value directly, route it through
  `collectAndStore(this, ctx)` from `@refarm.dev/silo` (keep the OAuth/prompt UX in the provider).

- [x] **Step 3: Verify existing credential tests pass**

Run (focused files — **never** the broad `-- credentials` filter, which pulls too many suites and can OOM the container): `pnpm -C apps/refarm run test -- src/credentials/model.test.ts src/credentials/token-auth-error.test.ts`
Expected: PASS — `credentials/model.test.ts`, `token-auth-error.test.ts`, and the type-check still pass with the re-homed contract.

- [x] **Step 4: Commit**

```bash
git add apps/refarm/src/credentials
git commit -m "refactor(refarm): re-home credential providers onto the silo collect contract"
```

---

### Task 5: Acceptance wiring

**Files:**
- Modify: `scripts/ci/test-capabilities.mjs`, `scripts/ci/gate-smoke-contracts.mjs`
- Create: `.changeset/silo-collection-contract.md`

- [x] **Step 1: Register `silo` in both gate lists** (per `docs/PACKAGE_ACCEPTANCE_CHECKLIST.md`; skip any already present)

`scripts/ci/test-capabilities.mjs` STEPS — add `["packages/silo", "test"]`.
`scripts/ci/gate-smoke-contracts.mjs` STEPS — add `["packages/silo", "build"]` and `["packages/silo", "test"]`.

- [x] **Step 2: Add the changeset** — `.changeset/silo-collection-contract.md`

```markdown
---
"@refarm.dev/silo": minor
---

Add a namespaced credential-collection front door (`CredentialProvider` + `collectAndStore`) and a namespaced secret store, keeping secret classes (model/runtime/channel/publishing) separate.
```

- [x] **Step 3: Final gate**

Run: `pnpm -C packages/silo run lint && pnpm -C packages/silo run build && pnpm -C packages/silo run test && pnpm run gate:smoke:contracts`
Expected: PASS.

Executed as a constrained-container checkpoint: `packages/silo` lint/build/test,
acceptance script `--plan` checks, `git diff --check`, and
`refarm agent finish --lane after-edit --run --json` passed. The full
`gate:smoke:contracts` repo gate remains a push/release checkpoint to avoid
repeating the broad JS/Rust fan-out that previously OOM-stalled the container.

- [x] **Step 4: Commit**

```bash
git add scripts/ci/test-capabilities.mjs scripts/ci/gate-smoke-contracts.mjs .changeset/silo-collection-contract.md
git commit -m "chore(silo): register collection contract in acceptance gates"
```

---

## Explicit Non-Goal

Do not migrate `vault-seed/packages/cli/src/silo.js` here. That is **item 8a** and needs its own consumer-bridge spec.

## Self-Review

**Spec coverage:** collection contract in silo (§1) → Tasks 1–2; namespaced (decision 2) → Task 1 store + Task 2 routing; re-home app providers (§2, decision) → Task 4; type-only dep + acyclic (§2/§3) → Task 3; reserved namespaces (decision) → documented in `collect.js` JSDoc; acceptance (§6) → Task 5; vault-seed deferred (§4) → Explicit Non-Goal. ✓

**Placeholder scan:** Task 4 Steps 1–2 modify existing app files with exact field values and import source — concrete additive changes, gated by the existing credential tests (not fabricated internals).

**Type consistency:** `collectAndStore`, `CredentialProvider.namespace`, `saveSecret/loadSecret` consistent across `index.js`, `collect.js`, and the two test files. `silo` stays JS+JSDoc (no new `.ts` source), matching `index.js`.
