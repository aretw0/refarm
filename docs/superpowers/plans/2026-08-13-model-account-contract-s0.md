# Model Account Contract — S0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two credentials of the same provider coexist on this node, each with an opaque id and a renameable alias; a workspace binding selects one deterministically; and two eligible credentials with no binding **refuse** instead of guessing.

**Architecture:** A new contract package holds pure types, a pure resolver, and a descriptor catalog with no provider traffic and no secret values. Secrets stay in Silo under namespace `model` keyed by the opaque credential id; the catalog holds only descriptors. The CLI surface (`refarm credential list|bind|current`) projects the resolver; it never implements precedence of its own.

**Tech Stack:** TypeScript, vitest, `@refarm.dev/silo`, Commander. No provider traffic, no network, no new runtime dependency.

**Spec:** [`docs/superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md`](../specs/2026-08-06-account-aware-copilot-kimi-providers-design.md) — slice **S0**, decisions **D1**, **D2**, **D3**, plus the "Migration and compatibility" section.

## Why this plan exists and an earlier draft does not

A competing spec was written on 2026-08-13 and **withdrawn before commit**. It proposed a flat
`oauthCredentials["provider/account"]` key, which contradicts D2 (`secretRef` into Silo's `model`
namespace, descriptors in a separate non-secret catalog) and D1 (an opaque `credentialId` with a
separately renameable `alias`). The canonical design already decided every question that draft
re-opened, including the ambiguity refusal. Two specs for one subject is the defect this repository
removes everywhere else; the older one has authority.

## Global Constraints

- **S0 makes NO provider traffic.** No network, no OAuth, no Copilot, no Kimi. Fixtures only. A task that needs a live provider belongs to S1 or later.
- **Never return secret values from a listing.** `listSecrets(namespace)` returns values and therefore **must not** back `credential list` (D2, measured constraint). The listing returns id, readability, protection scheme and revision.
- **`saveIdentityMetadata()` cannot own this catalog** — it is a shallow global identity map (D2, measured). S0 adds two explicit primitives instead of composing unsafe surfaces.
- **Zero new runtime dependencies.**
- **Aliases carry no meaning.** `blue`, `personal`, `client-x` all have the same contract meaning: none. Nothing may branch on an alias's text.
- **Run tests as `pnpm -C <package> exec vitest run <file>`** — never `pnpm --filter <pkg> exec vitest`, which runs from the repo root outside vitest's home containment and writes into the real `$HOME`.
- **`pnpm --filter <pkg> run type-check` after every task.** `build` uses `tsconfig.build.json`, which excludes tests; only `type-check` sees a broken fixture.
- **A new package must be hand-fed two registries** — `scripts/release.mjs`'s package list and `scripts/ci/contract-reachability-baseline.json`. The `before-push` lane runs scaffold, build-order and audit gates, but neither registry is written for you.
- **Three states, never two.** Every read that can fail differently reports which.
- **Commit after every task**, with `refarm agent finish --lane after-edit --run --json` before and `--lane after-commit --run --json` after.

---

## File Structure

| file | responsibility |
| --- | --- |
| `packages/model-account-contract-v1/` (create) | The contract. Copy the shape of `packages/identity-contract-v1` (same `package.json` scripts, `tsconfig.build.json`, `eslint.config.mjs`, `vitest.config.ts`). |
| `…/src/types.ts` | Descriptor, binding, dispatch snapshot, health, refusal codes. Types and constants only. |
| `…/src/resolve.ts` | PURE. D3's precedence, and the ambiguity refusal. No I/O. |
| `…/src/catalog.ts` | PURE. Descriptor collection operations and the `incomplete`/`unclaimed` health rules. No I/O. |
| `…/src/migrate.ts` | PURE. Reads the legacy flat token schema as an implicit `<provider>/default`, `unverified`. |
| `…/src/index.ts` | The public surface. |
| `apps/refarm/src/commands/credential.ts` (create) | `credential list \| bind \| current`. The only file here that touches Silo or the config. |
| `apps/refarm/src/program.ts` (modify) | Register `credentialCommand` eagerly, beside `nodeCommand`. |
| `scripts/release.mjs` (modify) | Add the package to the publish list. |
| `scripts/ci/contract-reachability-baseline.json` (modify) | Only if the reachability gate reports an unreferenced export. |

---

## Task 1: The contract package and its types

**Files:**
- Create: `packages/model-account-contract-v1/{package.json,tsconfig.json,tsconfig.build.json,eslint.config.mjs,vitest.config.ts,README.md}`
- Create: `packages/model-account-contract-v1/src/types.ts`, `src/index.ts`
- Test: `packages/model-account-contract-v1/src/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MODEL_ACCOUNT_CAPABILITY`, `ModelAccountDescriptor`, `ModelAccountHealth`, `ModelAccountBinding`, `DispatchSnapshot`, `ModelAccountRefusal`, `REFUSAL_CODES`, `newCredentialId(seed: string): string`.

- [ ] **Step 1: Scaffold the package by copying an existing contract**

```bash
mkdir -p packages/model-account-contract-v1/src
for f in tsconfig.json tsconfig.build.json eslint.config.mjs vitest.config.ts; do
  cp packages/identity-contract-v1/$f packages/model-account-contract-v1/$f
done
```

Then write `packages/model-account-contract-v1/package.json`, identical to
`packages/identity-contract-v1/package.json` except for these three fields:

```json
	"name": "@refarm.dev/model-account-contract-v1",
	"description": "Versioned model-account identity contract (model-account:v1) and pure resolver",
	"repository": { "type": "git", "url": "https://github.com/aretw0/refarm.git", "directory": "packages/model-account-contract-v1" },
```

and `keywords`: `["plugin", "capability", "model-account", "contract", "conformance"]`.

Write a `README.md` whose first paragraph states what the package is and that it makes no provider
traffic — `scripts/audit-readme-quality.mjs` is a gate.

- [ ] **Step 2: Write the failing test**

Create `packages/model-account-contract-v1/src/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { newCredentialId, REFUSAL_CODES } from "./types.js";

describe("newCredentialId", () => {
	it("is opaque and prefixed, so a reader cannot mistake it for an alias", () => {
		// D1: the id is "generated, node-local, stable, and semantically opaque". An id that read as
		// a login or an alias would invite exactly the branching D1 forbids.
		const id = newCredentialId("seed-1");
		expect(id).toMatch(/^model-account:[0-9A-Z]{26}$/u);
	});

	it("is STABLE for a seed, so a rename cannot change it", () => {
		// The acceptance row "rename blue to client-x → opaque id, binding, secret and history are
		// unchanged" only holds if the id never derives from the alias.
		expect(newCredentialId("seed-1")).toBe(newCredentialId("seed-1"));
		expect(newCredentialId("seed-1")).not.toBe(newCredentialId("seed-2"));
	});

	it("does not leak its seed", () => {
		// A seed may be a provider subject. The id travels into logs, status and budget exports,
		// where the spec allows "safe credential id only; no token, email, or GitHub login".
		expect(newCredentialId("github:12345")).not.toContain("12345");
		expect(newCredentialId("github:12345")).not.toContain("github");
	});
});

describe("REFUSAL_CODES", () => {
	it("names the ambiguity refusal exactly as the spec's acceptance matrix does", () => {
		// Consumers assert on this string. It is a contract, not a message.
		expect(REFUSAL_CODES.ambiguous).toBe("model_credential_ambiguous");
	});

	it("separates the three unusable states, which are not one state", () => {
		expect(new Set(Object.values(REFUSAL_CODES)).size).toBe(Object.values(REFUSAL_CODES).length);
		expect(REFUSAL_CODES).toMatchObject({
			ambiguous: "model_credential_ambiguous",
			none: "model_credential_none",
			incomplete: "model_credential_incomplete",
			unclaimed: "model_credential_unclaimed",
		});
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/types.test.ts`
Expected: FAIL — `Failed to resolve import "./types.js"`.

- [ ] **Step 4: Write `src/types.ts`**

```ts
/**
 * MODEL-ACCOUNT IDENTITY — the contract that lets one provider hold many credentials.
 *
 * The governing design is `docs/superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md`.
 * Its D1 separates three identities this repository used to collapse into one: a PROVIDER is a
 * protocol and billing product, a MODEL ACCOUNT is one credential-bearing identity on this node,
 * and a WORKSPACE BINDING says which account a workspace's work spends.
 *
 * Measured 2026-08-12, against a real silo: `oauthCredentials` is keyed by provider and holds one
 * slot, so a second GitHub Copilot login destroyed the first with no warning. The operator holds
 * three quotas across two providers; two of them are the same provider.
 *
 * NOTHING HERE MAY BRANCH ON AN ALIAS. `blue`, `personal` and `client-x` have exactly the same
 * contract meaning: none. Refarm does not prescribe an account taxonomy (D1).
 */
import { createHash } from "node:crypto";

export const MODEL_ACCOUNT_CAPABILITY = "model-account:v1" as const;

/** Crockford base32, so an id is copyable by voice and cannot be mistaken for hex. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A node-local, stable, semantically opaque credential id.
 *
 * DERIVED FROM A SEED RATHER THAN FROM RANDOMNESS so the same login produces the same id on a
 * re-run, and DIGESTED so the seed — which may be a provider subject — never travels inside it.
 * The id appears in logs, status and budget exports, where the design permits the id and nothing
 * else about the account.
 */
export function newCredentialId(seed: string): string {
	const digest = createHash("sha256").update(seed).digest();
	let out = "";
	for (let i = 0; i < 26; i += 1) out += CROCKFORD[digest[i]! % 32];
	return `model-account:${out}`;
}

/** Whether a catalog entry may be routed to, and when not, why not. */
export type ModelAccountHealth =
	| "healthy"
	/** A descriptor whose secret is missing. Never silently deleted, never eligible (D2). */
	| "incomplete"
	/** A secret with no descriptor. Redacted, requires repair or removal (D2). */
	| "unclaimed";

export interface ModelAccountIdentity {
	/** `verified` only when the provider confirmed it. A migrated legacy credential is `unverified`. */
	readonly status: "verified" | "unverified";
	/** The provider's immutable identifier when one exists — never a display login. */
	readonly subject?: string;
	readonly host?: string;
}

export interface ModelAccountDescriptor {
	readonly credentialId: string;
	readonly provider: string;
	/** Operator-chosen, renameable, unique per provider on this node, and MEANINGLESS to code. */
	readonly alias: string;
	readonly identity: ModelAccountIdentity;
	/** Where the secret lives in Silo — a reference, never the secret. */
	readonly secretRef: string;
	readonly health: ModelAccountHealth;
	/** Changes when metadata or the secret changes, so a snapshot can pin what it selected. */
	readonly revision: string;
}

/** The node's workspace registry owns this and persists the OPAQUE ID, never the alias (D2). */
export interface ModelAccountBinding {
	readonly workspaceId: string;
	readonly credentialId: string;
}

/** What the resolver returns when it can select. Immutable, and the only thing a surface reads. */
export interface DispatchSnapshot {
	readonly workspaceId: string | null;
	readonly provider: string;
	readonly credentialId: string;
	readonly credentialAlias: string;
	readonly credentialRevision: string;
	readonly source: "dispatch-override" | "workspace-binding" | "node-default" | "env";
}

export const REFUSAL_CODES = {
	ambiguous: "model_credential_ambiguous",
	none: "model_credential_none",
	incomplete: "model_credential_incomplete",
	unclaimed: "model_credential_unclaimed",
} as const;

export type RefusalCode = (typeof REFUSAL_CODES)[keyof typeof REFUSAL_CODES];

export interface ModelAccountRefusal {
	readonly code: RefusalCode;
	readonly message: string;
	/** SAFE candidates — aliases and ids only, so a refusal can be printed anywhere. */
	readonly candidates: readonly { readonly credentialId: string; readonly alias: string }[];
}
```

And `src/index.ts`:

```ts
export * from "./types.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/types.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Feed the two registries and prove the package conforms**

In `scripts/release.mjs`, add `"model-account-contract-v1"` to the package list (the array that
contains `"identity-contract-v1"` near line 34), keeping alphabetical order.

```bash
pnpm install
node scripts/validate-packages.mjs
node scripts/audit-readme-quality.mjs
pnpm --filter @refarm.dev/model-account-contract-v1 run build
pnpm --filter @refarm.dev/model-account-contract-v1 run type-check
```
Expected: all pass. If the contract-reachability gate names an export nothing references yet, add it
to `scripts/ci/contract-reachability-baseline.json` **with a written reason**, the way the existing
entries do — the baseline is a signed statement, not a mute list.

- [ ] **Step 7: Commit**

```bash
git add packages/model-account-contract-v1 scripts/release.mjs pnpm-lock.yaml
git commit -m "feat(model-account): the contract for a provider that holds many credentials"
```

---

## Task 2: The resolver

**Files:**
- Create: `packages/model-account-contract-v1/src/resolve.ts`
- Test: `packages/model-account-contract-v1/src/resolve.test.ts`
- Modify: `packages/model-account-contract-v1/src/index.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `resolveModelAccount(input: ResolveInput): DispatchSnapshot | ModelAccountRefusal`, `isRefusal(value: unknown): value is ModelAccountRefusal`, `ResolveInput`.

- [ ] **Step 1: Write the failing test**

Create `packages/model-account-contract-v1/src/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isRefusal, resolveModelAccount } from "./resolve.js";
import { REFUSAL_CODES, type ModelAccountDescriptor } from "./types.js";

const account = (
	alias: string,
	overrides: Partial<ModelAccountDescriptor> = {},
): ModelAccountDescriptor => ({
	credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
	provider: "github-copilot",
	alias,
	identity: { status: "unverified" },
	secretRef: `model/${alias}`,
	health: "healthy",
	revision: "sha256:r1",
	...overrides,
});

const BLUE = account("blue");
const GREEN = account("green");

describe("resolveModelAccount — D3 precedence", () => {
	it("selects the single eligible credential when nothing is bound", () => {
		// Every node that exists today is in this case, and it must not have to declare anything.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE],
			bindings: [],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ credentialId: BLUE.credentialId, source: "node-default" });
	});

	it("prefers the WORKSPACE BINDING over the node default", () => {
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [{ workspaceId: "rcdc5", credentialId: GREEN.credentialId }],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ credentialId: GREEN.credentialId, source: "workspace-binding" });
	});

	it("prefers an explicit dispatch override over the binding", () => {
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [{ workspaceId: "rcdc5", credentialId: GREEN.credentialId }],
			workspaceId: "rcdc5",
			overrideCredentialId: BLUE.credentialId,
		});
		expect(result).toMatchObject({ credentialId: BLUE.credentialId, source: "dispatch-override" });
	});

	it("resolves a workspace WITHOUT inspecting a working directory", () => {
		// The acceptance row "workspace refarm resolves its own binding without inspecting cwd".
		// There is no cwd input to this function at all, which is how the guarantee is kept.
		const both = { provider: "github-copilot", accounts: [BLUE, GREEN] };
		const bindings = [
			{ workspaceId: "rcdc5", credentialId: GREEN.credentialId },
			{ workspaceId: "refarm", credentialId: BLUE.credentialId },
		];
		expect(resolveModelAccount({ ...both, bindings, workspaceId: "refarm" })).toMatchObject({
			credentialId: BLUE.credentialId,
		});
		expect(resolveModelAccount({ ...both, bindings, workspaceId: "rcdc5" })).toMatchObject({
			credentialId: GREEN.credentialId,
		});
	});
});

describe("resolveModelAccount — refusals", () => {
	it("REFUSES two eligible credentials with no binding, naming safe candidates", () => {
		// The row this whole slice exists for. Choosing the last login, the newest, or the first key
		// would be a guess wearing an answer's clothes — and it would spend the corporate quota on
		// personal work, silently.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [],
			workspaceId: "rcdc5",
		});
		expect(isRefusal(result)).toBe(true);
		expect(result).toMatchObject({ code: REFUSAL_CODES.ambiguous });
		expect((result as { candidates: { alias: string }[] }).candidates.map((c) => c.alias)).toEqual([
			"blue",
			"green",
		]);
	});

	it("carries NO secret and no subject in a refusal", () => {
		// A refusal is printed on any surface, including a phone and a log.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [account("blue", { identity: { status: "verified", subject: "github:99" } }), GREEN],
			bindings: [],
			workspaceId: null,
		});
		expect(JSON.stringify(result)).not.toContain("github:99");
	});

	it("refuses NONE differently from ambiguous", () => {
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [],
			bindings: [],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ code: REFUSAL_CODES.none });
	});

	it("does not count an INCOMPLETE entry as eligible, and says so when it is the only one", () => {
		// D2: a descriptor whose secret is missing is never "healthy" and never routable. Counting it
		// would produce a snapshot pointing at a secret that is not there.
		const broken = account("blue", { health: "incomplete" });
		expect(
			resolveModelAccount({
				provider: "github-copilot",
				accounts: [broken],
				bindings: [],
				workspaceId: null,
			}),
		).toMatchObject({ code: REFUSAL_CODES.incomplete });
	});

	it("ignores an UNCLAIMED entry when a healthy one exists, rather than calling it ambiguous", () => {
		// An orphaned secret must not make a working single-account node refuse.
		const orphan = account("ghost", { health: "unclaimed" });
		expect(
			resolveModelAccount({
				provider: "github-copilot",
				accounts: [BLUE, orphan],
				bindings: [],
				workspaceId: null,
			}),
		).toMatchObject({ credentialId: BLUE.credentialId });
	});

	it("refuses an override naming a credential that is not eligible", () => {
		// An override is authorised, not magic: it may not reach an entry the catalog says is broken.
		expect(
			isRefusal(
				resolveModelAccount({
					provider: "github-copilot",
					accounts: [BLUE, account("green", { health: "incomplete" })],
					bindings: [],
					workspaceId: null,
					overrideCredentialId: GREEN.credentialId,
				}),
			),
		).toBe(true);
	});

	it("ignores a binding for a DIFFERENT provider", () => {
		// Aliases are unique only within a provider, and bindings are per workspace: a kimi binding
		// must not select a copilot credential or suppress its ambiguity.
		const result = resolveModelAccount({
			provider: "github-copilot",
			accounts: [BLUE, GREEN],
			bindings: [{ workspaceId: "rcdc5", credentialId: "model-account:KIMIXXXXXXXXXXXXXXXXXXXXXX" }],
			workspaceId: "rcdc5",
		});
		expect(result).toMatchObject({ code: REFUSAL_CODES.ambiguous });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve.js"`.

- [ ] **Step 3: Write `src/resolve.ts`**

```ts
/**
 * D3 — RESOLUTION IS EXPLICIT, SURFACE-NEUTRAL AND FAIL-CLOSED.
 *
 * Precedence, and there is no fifth option:
 *   1. an explicit, authorised dispatch override
 *   2. the node-owned workspace binding
 *   3. a node default ONLY when exactly one eligible credential exists
 *   4. refusal
 *
 * WHAT IS NOT A SELECTOR, listed because each one has been a selector in some tool: the current
 * working directory, the last login, the last used account, the provider's model default, and any
 * ambient environment variable. This function takes no `cwd`, no clock and no `process.env` — the
 * guarantee is kept by the signature, not by discipline.
 *
 * PURE. Every input is passed in, so a surface cannot resolve differently from the runtime, and the
 * ambiguity refusal can be tested against a node that does not exist.
 */
import {
	REFUSAL_CODES,
	type DispatchSnapshot,
	type ModelAccountBinding,
	type ModelAccountDescriptor,
	type ModelAccountRefusal,
} from "./types.js";

export interface ResolveInput {
	readonly provider: string;
	readonly accounts: readonly ModelAccountDescriptor[];
	readonly bindings: readonly ModelAccountBinding[];
	/** `null` when the dispatch has no workspace — a node-level ask. */
	readonly workspaceId: string | null;
	readonly overrideCredentialId?: string;
}

export function isRefusal(value: unknown): value is ModelAccountRefusal {
	return typeof value === "object" && value !== null && "code" in value;
}

/** SAFE by construction: id and alias only, never identity, never the secret reference. */
const safeCandidates = (accounts: readonly ModelAccountDescriptor[]) =>
	accounts.map((a) => ({ credentialId: a.credentialId, alias: a.alias }));

const snapshot = (
	account: ModelAccountDescriptor,
	workspaceId: string | null,
	source: DispatchSnapshot["source"],
): DispatchSnapshot => ({
	workspaceId,
	provider: account.provider,
	credentialId: account.credentialId,
	credentialAlias: account.alias,
	credentialRevision: account.revision,
	source,
});

export function resolveModelAccount(input: ResolveInput): DispatchSnapshot | ModelAccountRefusal {
	const ofProvider = input.accounts.filter((a) => a.provider === input.provider);
	const eligible = ofProvider.filter((a) => a.health === "healthy");

	if (input.overrideCredentialId) {
		const chosen = eligible.find((a) => a.credentialId === input.overrideCredentialId);
		if (chosen) return snapshot(chosen, input.workspaceId, "dispatch-override");
		return {
			code: REFUSAL_CODES.none,
			message: `the requested credential is not an eligible ${input.provider} account on this node`,
			candidates: safeCandidates(eligible),
		};
	}

	if (input.workspaceId) {
		const bound = input.bindings.find((b) => b.workspaceId === input.workspaceId);
		const chosen = bound && eligible.find((a) => a.credentialId === bound.credentialId);
		// A binding naming a provider's credential that is not this provider's simply does not match,
		// and the resolution continues rather than refusing: the workspace may be bound per provider.
		if (chosen) return snapshot(chosen, input.workspaceId, "workspace-binding");
	}

	if (eligible.length === 1) return snapshot(eligible[0]!, input.workspaceId, "node-default");

	if (eligible.length > 1) {
		return {
			code: REFUSAL_CODES.ambiguous,
			message:
				`${eligible.length} ${input.provider} accounts are eligible and nothing said which to use. ` +
				`Bind one to this workspace, or name one explicitly.`,
			candidates: safeCandidates(eligible),
		};
	}

	// Zero eligible. WHY it is zero is three different sentences, and an operator repairs each one
	// differently: nothing is registered, a secret is missing, or a secret has no descriptor.
	const incomplete = ofProvider.filter((a) => a.health === "incomplete");
	if (incomplete.length > 0) {
		return {
			code: REFUSAL_CODES.incomplete,
			message: `every ${input.provider} account on this node is missing its secret`,
			candidates: safeCandidates(incomplete),
		};
	}
	const unclaimed = ofProvider.filter((a) => a.health === "unclaimed");
	if (unclaimed.length > 0) {
		return {
			code: REFUSAL_CODES.unclaimed,
			message: `a ${input.provider} secret exists with no descriptor — repair or remove it`,
			candidates: safeCandidates(unclaimed),
		};
	}
	return {
		code: REFUSAL_CODES.none,
		message: `no ${input.provider} account is registered on this node`,
		candidates: [],
	};
}
```

Add to `src/index.ts`:

```ts
export * from "./resolve.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/resolve.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/model-account-contract-v1 run type-check
git add packages/model-account-contract-v1/src
git commit -m "feat(model-account): a resolver that refuses rather than guesses which account"
```

---

## Task 3: The catalog and its health rules

**Files:**
- Create: `packages/model-account-contract-v1/src/catalog.ts`
- Test: `packages/model-account-contract-v1/src/catalog.test.ts`
- Modify: `packages/model-account-contract-v1/src/index.ts`

**Interfaces:**
- Consumes: Task 1's types.
- Produces: `reconcileCatalog(descriptors, secretRefs): ModelAccountDescriptor[]`, `upsertDescriptor(catalog, descriptor): ModelAccountDescriptor[]`, `renameAlias(catalog, credentialId, alias): ModelAccountDescriptor[] | ModelAccountRefusal`, `descriptorRevision(input): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/model-account-contract-v1/src/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { descriptorRevision, reconcileCatalog, renameAlias, upsertDescriptor } from "./catalog.js";
import { isRefusal } from "./resolve.js";
import type { ModelAccountDescriptor } from "./types.js";

const account = (
	alias: string,
	overrides: Partial<ModelAccountDescriptor> = {},
): ModelAccountDescriptor => ({
	credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
	provider: "github-copilot",
	alias,
	identity: { status: "unverified" },
	secretRef: `model/${alias}`,
	health: "healthy",
	revision: "sha256:r1",
	...overrides,
});

describe("reconcileCatalog", () => {
	it("marks a descriptor whose secret is missing INCOMPLETE, and never deletes it", () => {
		// D2's recoverable consistency rule. The acceptance row is "descriptor write succeeds, secret
		// write fails → entry is incomplete and ineligible, never healthy". Deleting it would discard
		// the only record that the login happened.
		const [entry] = reconcileCatalog([account("blue")], []);
		expect(entry).toMatchObject({ alias: "blue", health: "incomplete" });
	});

	it("surfaces a secret with no descriptor as UNCLAIMED rather than hiding it", () => {
		// A secret nothing describes is the operator's material and may be the only copy. Silence
		// here is how it gets deleted by someone tidying up.
		const catalog = reconcileCatalog([], ["model/orphan"]);
		expect(catalog).toHaveLength(1);
		expect(catalog[0]).toMatchObject({ health: "unclaimed", secretRef: "model/orphan" });
	});

	it("calls a matched pair healthy", () => {
		expect(reconcileCatalog([account("blue")], ["model/blue"])[0]).toMatchObject({
			health: "healthy",
		});
	});

	it("is deterministic in order, so two runs produce the same listing", () => {
		const a = reconcileCatalog([account("green"), account("blue")], ["model/blue", "model/green"]);
		const b = reconcileCatalog([account("blue"), account("green")], ["model/green", "model/blue"]);
		expect(a.map((e) => e.alias)).toEqual(b.map((e) => e.alias));
	});
});

describe("upsertDescriptor", () => {
	it("adds a second account of the SAME provider without touching the first", () => {
		// The whole point, and the acceptance row: "login alias blue, then account-03 → both
		// credentials remain independently usable".
		const catalog = upsertDescriptor([account("blue")], account("account-03"));
		expect(catalog).toHaveLength(2);
		expect(catalog.find((e) => e.alias === "blue")).toEqual(account("blue"));
	});

	it("replaces an entry with the same id, leaving siblings byte-identical", () => {
		// "re-login account-03 → blue secret and revision are unchanged".
		const blue = account("blue");
		const before = upsertDescriptor([blue], account("account-03"));
		const after = upsertDescriptor(before, account("account-03", { revision: "sha256:r2" }));
		expect(after).toHaveLength(2);
		expect(after.find((e) => e.alias === "blue")).toEqual(blue);
		expect(after.find((e) => e.alias === "account-03")?.revision).toBe("sha256:r2");
	});
});

describe("renameAlias", () => {
	it("changes ONLY the alias — id, secretRef and revision survive", () => {
		// "rename blue to client-x → opaque id, binding, secret and history are unchanged". A rename
		// that moved the id would break every binding pointing at it.
		const blue = account("blue");
		const renamed = renameAlias([blue], blue.credentialId, "client-x");
		expect(isRefusal(renamed)).toBe(false);
		const entry = (renamed as ModelAccountDescriptor[])[0]!;
		expect(entry).toMatchObject({
			alias: "client-x",
			credentialId: blue.credentialId,
			secretRef: blue.secretRef,
			revision: blue.revision,
		});
	});

	it("refuses a collision within one provider, and allows it ACROSS providers", () => {
		// D1: "Aliases are unique only within a provider on the node, so github-copilot/blue and
		// kimi-api/blue may coexist."
		const catalog = [account("blue"), account("green")];
		expect(isRefusal(renameAlias(catalog, catalog[1]!.credentialId, "blue"))).toBe(true);

		const across = [account("blue"), account("kimi", { provider: "kimi-api" })];
		expect(isRefusal(renameAlias(across, across[1]!.credentialId, "blue"))).toBe(false);
	});
});

describe("descriptorRevision", () => {
	it("changes when the secret changes and when metadata changes", () => {
		const base = { secretDigest: "s1", provider: "p", alias: "a", identitySubject: undefined };
		expect(descriptorRevision(base)).toBe(descriptorRevision({ ...base }));
		expect(descriptorRevision({ ...base, secretDigest: "s2" })).not.toBe(descriptorRevision(base));
		expect(descriptorRevision({ ...base, alias: "b" })).not.toBe(descriptorRevision(base));
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/catalog.test.ts`
Expected: FAIL — `Failed to resolve import "./catalog.js"`.

- [ ] **Step 3: Write `src/catalog.ts`**

```ts
/**
 * THE DESCRIPTOR CATALOG — what the node knows about its accounts, and nothing it must not say.
 *
 * D2 measured two constraints this file exists to respect rather than work around:
 *  - `saveIdentityMetadata()` is a shallow GLOBAL identity map and cannot own a multi-record
 *    catalog.
 *  - `listSecrets(namespace)` RETURNS SECRET VALUES and therefore cannot back `credential list`.
 *
 * So the catalog is its own thing, holds descriptors only, and is reconciled against a listing of
 * secret REFERENCES — never against secret material.
 *
 * NOTHING IS DELETED HERE. A descriptor without a secret is `incomplete`; a secret without a
 * descriptor is `unclaimed`. Both are the operator's material and may be the only copy; a tidy-up
 * that removed either would be irreversible and silent, which is the class of accident this whole
 * area has spent a week removing.
 *
 * PURE, and deterministic in order, so `credential list` reads the same twice.
 */
import { createHash } from "node:crypto";

import {
	newCredentialId,
	REFUSAL_CODES,
	type ModelAccountDescriptor,
	type ModelAccountRefusal,
} from "./types.js";

/** A revision that moves when the secret OR the metadata moves, so a snapshot pins both. */
export function descriptorRevision(input: {
	secretDigest: string;
	provider: string;
	alias: string;
	identitySubject?: string;
}): string {
	const digest = createHash("sha256")
		.update(JSON.stringify([input.secretDigest, input.provider, input.alias, input.identitySubject ?? ""]))
		.digest("hex");
	return `sha256:${digest.slice(0, 32)}`;
}

/**
 * Match descriptors against the secret references that actually exist.
 *
 * `secretRefs` comes from the secret-DESCRIPTOR listing (Task 4), which returns ids and never
 * values.
 */
export function reconcileCatalog(
	descriptors: readonly ModelAccountDescriptor[],
	secretRefs: readonly string[],
): ModelAccountDescriptor[] {
	const present = new Set(secretRefs);
	const described = new Set(descriptors.map((d) => d.secretRef));
	const matched: ModelAccountDescriptor[] = descriptors.map((d) => ({
		...d,
		health: present.has(d.secretRef) ? ("healthy" as const) : ("incomplete" as const),
	}));
	const orphans: ModelAccountDescriptor[] = secretRefs
		.filter((ref) => !described.has(ref))
		.map((ref) => ({
			// DERIVED FROM THE REF, not a shared constant. Two orphans sharing one id would collapse
			// into a single row in `credential list` and one of the operator's secrets would vanish
			// from the only surface that reports it.
			credentialId: newCredentialId(`unclaimed:${ref}`),
			provider: "unknown",
			alias: ref,
			identity: { status: "unverified" as const },
			secretRef: ref,
			health: "unclaimed" as const,
			revision: "sha256:unclaimed",
		}));
	return [...matched, ...orphans].sort((a, b) => a.secretRef.localeCompare(b.secretRef));
}

/** Add or replace by opaque id. Siblings are returned untouched, by identity. */
export function upsertDescriptor(
	catalog: readonly ModelAccountDescriptor[],
	descriptor: ModelAccountDescriptor,
): ModelAccountDescriptor[] {
	const without = catalog.filter((e) => e.credentialId !== descriptor.credentialId);
	return [...without, descriptor];
}

/** Rename, changing the alias and NOTHING else. Uniqueness is per provider (D1). */
export function renameAlias(
	catalog: readonly ModelAccountDescriptor[],
	credentialId: string,
	alias: string,
): ModelAccountDescriptor[] | ModelAccountRefusal {
	const target = catalog.find((e) => e.credentialId === credentialId);
	if (!target) {
		return {
			code: REFUSAL_CODES.none,
			message: "no account on this node carries that id",
			candidates: catalog.map((e) => ({ credentialId: e.credentialId, alias: e.alias })),
		};
	}
	const clash = catalog.find(
		(e) => e.provider === target.provider && e.alias === alias && e.credentialId !== credentialId,
	);
	if (clash) {
		return {
			code: REFUSAL_CODES.ambiguous,
			message: `another ${target.provider} account already uses the alias "${alias}"`,
			candidates: [{ credentialId: clash.credentialId, alias: clash.alias }],
		};
	}
	return catalog.map((e) => (e.credentialId === credentialId ? { ...e, alias } : e));
}
```

Add to `src/index.ts`:

```ts
export * from "./catalog.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/catalog.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the SECOND primitive D2 requires — a secret listing that returns no secrets**

`reconcileCatalog` consumes `secretRefs`, and nothing produces them yet. D2 is explicit that S0 adds
**two** primitives and that neither may be improvised out of what exists:

> *"`listSecrets(namespace)` returns secret values and therefore cannot back `credential list`. S0
> must add two explicit primitives rather than compose these unsafe surfaces accidentally."*

Create `packages/silo/src/secret-descriptors.js` (this package is **JS-Atomic** — the `.js` in `src/`
is source, not an artifact):

```js
/**
 * WHAT SECRETS EXIST, WITHOUT READING ANY OF THEM.
 *
 * `listSecrets(namespace)` returns VALUES. Anything that shows the operator a list of credentials
 * must not call it, because the list travels to a terminal, a log, a phone and a JSON consumer. This
 * returns the descriptor of each secret and never its material.
 *
 * `readable` is a THIRD state beside present and absent: a secret whose envelope exists but cannot
 * be opened by this node is neither missing nor usable, and reporting it as either sends the
 * operator to the wrong repair.
 */
export function listSecretDescriptors(store, namespace) {
	const ids = store.listSecretIds?.(namespace) ?? [];
	return ids.map((id) => {
		const envelope = store.peekSecretEnvelope?.(namespace, id);
		return {
			id,
			ref: `${namespace}/${id}`,
			readable: envelope ? Boolean(envelope.readable) : false,
			protection: envelope?.scheme ?? "unknown",
			revision: envelope?.revision ?? null,
		};
	});
}
```

Create `packages/silo/src/secret-descriptors.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { listSecretDescriptors } from "./secret-descriptors.js";

const store = {
	listSecretIds: () => ["acc-a", "acc-b"],
	peekSecretEnvelope: (_ns: string, id: string) =>
		id === "acc-a"
			? { readable: true, scheme: "owner-plaintext-v1", revision: "r1" }
			: { readable: false, scheme: "owner-plaintext-v1", revision: "r2" },
};

describe("listSecretDescriptors", () => {
	it("returns NO secret material, checked against the whole serialised result", () => {
		// The assertion that matters. A field added later that happens to carry a value would slip
		// past a key-name check; this would not.
		const serialised = JSON.stringify(listSecretDescriptors(store, "model"));
		expect(serialised).not.toMatch(/token|access|secret[^-]/iu);
		expect(serialised).toContain("acc-a");
	});

	it("reports UNREADABLE as its own state, not as missing", () => {
		// An envelope this node cannot open is not an absent secret. Calling it absent would mark the
		// descriptor `incomplete` and invite the operator to log in again over a credential that is
		// still there.
		const [, b] = listSecretDescriptors(store, "model");
		expect(b).toMatchObject({ id: "acc-b", readable: false });
	});

	it("says a store that cannot list has nothing, rather than throwing", () => {
		expect(listSecretDescriptors({}, "model")).toEqual([]);
	});
});
```

Export it from `packages/silo/src/index.js` beside the existing exports.

Run: `pnpm -C packages/silo exec vitest run src/secret-descriptors.test.ts`
Expected: PASS, 3 tests.

**If `listSecretIds`/`peekSecretEnvelope` do not exist on `SiloCore`,** add them in the same task —
they are the non-value-returning half of the store and their absence is why `listSecrets` keeps
getting reached for. Do **not** implement them by calling `listSecrets` and discarding the values:
that reads every secret into memory to produce a list, which is the accident D2 names.

- [ ] **Step 6: Type-check and commit**

```bash
pnpm --filter @refarm.dev/model-account-contract-v1 run type-check
pnpm --filter @refarm.dev/silo run test
git add packages/model-account-contract-v1/src packages/silo/src
git commit -m "feat(model-account): a catalog that never deletes what it cannot explain"
```

---

## Task 4: The migration reader

**Files:**
- Create: `packages/model-account-contract-v1/src/migrate.ts`
- Test: `packages/model-account-contract-v1/src/migrate.test.ts`
- Modify: `packages/model-account-contract-v1/src/index.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces: `readLegacyCredentials(tokens: Record<string, unknown>): ModelAccountDescriptor[]`, `LEGACY_ALIAS`.

- [ ] **Step 1: Write the failing test**

Create `packages/model-account-contract-v1/src/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { LEGACY_ALIAS, readLegacyCredentials } from "./migrate.js";

/**
 * The migration is ADDITIVE AND REVERSIBLE (spec, "Migration and compatibility"): legacy entries are
 * READ as accounts, never rewritten. Nothing here writes; nothing dual-writes a secret value.
 */
describe("readLegacyCredentials", () => {
	it("reads a flat oauth entry as an implicit <provider>/default account", () => {
		const accounts = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "T", expires: 1, accountId: "acc-1" } },
		});
		expect(accounts).toHaveLength(1);
		expect(accounts[0]).toMatchObject({
			provider: "openai-codex",
			alias: LEGACY_ALIAS,
			secretRef: "model/openai-codex",
		});
	});

	it("marks a legacy identity UNVERIFIED until a provider verifies it", () => {
		// Step 2 of the migration. A credential refarm inherited was never checked against its
		// provider, and claiming otherwise would put a false `verified` into budget and status output.
		const [account] = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "T", expires: 1 } },
		});
		expect(account?.identity).toEqual({ status: "unverified" });
	});

	it("carries NO secret material into the descriptor", () => {
		// The descriptor travels to `credential list`. The access token must not be in it.
		const accounts = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "SECRET-TOKEN", refresh: "R", expires: 1 } },
		});
		expect(JSON.stringify(accounts)).not.toContain("SECRET-TOKEN");
	});

	it("reads an API-key provider too, which has the same one-slot limitation", () => {
		expect(
			readLegacyCredentials({ modelProvider: "anthropic", modelApiKey: "sk-x" })[0],
		).toMatchObject({ provider: "anthropic", alias: LEGACY_ALIAS });
	});

	it("returns nothing for an empty silo rather than inventing an account", () => {
		expect(readLegacyCredentials({})).toEqual([]);
		expect(readLegacyCredentials({ oauthCredentials: {} })).toEqual([]);
	});

	it("gives each legacy provider a DISTINCT opaque id", () => {
		const accounts = readLegacyCredentials({
			oauthCredentials: { "openai-codex": { access: "A" }, "github-copilot": { access: "B" } },
		});
		expect(new Set(accounts.map((a) => a.credentialId)).size).toBe(2);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/migrate.test.ts`
Expected: FAIL — `Failed to resolve import "./migrate.js"`.

- [ ] **Step 3: Write `src/migrate.ts`**

```ts
/**
 * READING THE OLD SHAPE — additive, reversible, and never a rewrite.
 *
 * The spec's migration is five steps and the first is the only one S0 performs: read legacy
 * `oauthCredentials[provider]` and `modelApiKey` as an implicit `<provider>/default` credential,
 * identity `unverified`. Nothing here writes. Nothing dual-writes a secret value. The operator's
 * silo is left exactly as it is until he next authenticates, which is what makes this reversible:
 * deleting this file restores the old behaviour completely.
 */
import { newCredentialId, type ModelAccountDescriptor } from "./types.js";

/** The alias a legacy credential is READ under. It is a display string and means nothing. */
export const LEGACY_ALIAS = "default";

function legacyDescriptor(provider: string): ModelAccountDescriptor {
	return {
		// Seeded by provider so a re-read produces the same id, and so a binding written against a
		// legacy account survives a restart.
		credentialId: newCredentialId(`legacy:${provider}`),
		provider,
		alias: LEGACY_ALIAS,
		identity: { status: "unverified" },
		secretRef: `model/${provider}`,
		health: "healthy",
		revision: "sha256:legacy",
	};
}

/** PURE. Legacy silo tokens read as accounts. Never returns secret material. */
export function readLegacyCredentials(tokens: Record<string, unknown>): ModelAccountDescriptor[] {
	const found: ModelAccountDescriptor[] = [];
	const oauth = tokens.oauthCredentials;
	if (oauth && typeof oauth === "object") {
		for (const provider of Object.keys(oauth as Record<string, unknown>)) {
			found.push(legacyDescriptor(provider));
		}
	}
	const apiProvider = typeof tokens.modelProvider === "string" ? tokens.modelProvider : undefined;
	const hasApiKey = typeof tokens.modelApiKey === "string" && tokens.modelApiKey.length > 0;
	if (apiProvider && hasApiKey && !found.some((a) => a.provider === apiProvider)) {
		found.push(legacyDescriptor(apiProvider));
	}
	return found.sort((a, b) => a.provider.localeCompare(b.provider));
}
```

Add to `src/index.ts`:

```ts
export * from "./migrate.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/model-account-contract-v1 exec vitest run src/migrate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/model-account-contract-v1 run type-check
pnpm --filter @refarm.dev/model-account-contract-v1 run build
git add packages/model-account-contract-v1/src
git commit -m "feat(model-account): read the old shape without rewriting it"
```

---

## Task 5: `refarm credential list | current | bind`

**Files:**
- Create: `apps/refarm/src/commands/credential.ts`
- Test: `apps/refarm/src/commands/credential.test.ts`
- Modify: `apps/refarm/src/program.ts`, `apps/refarm/package.json` (add the workspace dependency)
- Modify: `scripts/directory-independence.mjs` (probe `credential list`)

**Interfaces:**
- Consumes: the whole contract package.
- Produces: `createCredentialCommand(homeOf?, siloOf?): Command`, `credentialCommand`.

- [ ] **Step 1: Add the dependency**

In `apps/refarm/package.json`, add to `dependencies`, in alphabetical order:

```json
		"@refarm.dev/model-account-contract-v1": "workspace:*",
```

Then `pnpm install`.

- [ ] **Step 2: Write the failing test**

Create `apps/refarm/src/commands/credential.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createCredentialCommand } from "./credential.js";

const TOKENS = {
	oauthCredentials: { "openai-codex": { access: "SECRET-TOKEN", expires: 1, accountId: "acc-1" } },
};

async function run(
	argv: string[],
	tokens: Record<string, unknown> = TOKENS,
	catalog: unknown[] = [],
	secretRefs: string[] = ["model/openai-codex"],
) {
	const chunks: string[] = [];
	const write = process.stdout.write.bind(process.stdout);
	const log = console.log;
	const err = console.error;
	// `console.log` TOO: `printJson` goes through it, so a capture that replaced only
	// `process.stdout.write` would read every `--json` assertion below as an empty string.
	const collect = (...args: unknown[]) => void chunks.push(args.map(String).join(" "));
	process.stdout.write = ((c: string) => (chunks.push(String(c)), true)) as never;
	console.log = collect;
	console.error = collect;
	process.exitCode = 0;
	try {
		await createCredentialCommand({
			homeOf: () => "/nonexistent-home",
			siloOf: () => ({ loadTokens: async () => tokens, saveTokens: async () => tokens }),
			catalogOf: () => catalog as never,
			secretRefsOf: () => secretRefs,
			bindingsOf: () => [],
		}).parseAsync(argv, { from: "user" });
	} finally {
		process.stdout.write = write;
		console.log = log;
		console.error = err;
	}
	const exitCode = Number(process.exitCode ?? 0);
	process.exitCode = 0;
	return { out: chunks.join(""), exitCode };
}

describe("credential list", () => {
	it("lists a legacy credential as an account, and prints NO secret", () => {
		// The acceptance row: "credential listing returns ids/aliases/protection only, never calls
		// value-returning listSecrets". Asserted against the whole output, not against field names.
		return run(["list", "--json"]).then(({ out }) => {
			expect(out).toContain("openai-codex");
			expect(out).toContain("default");
			expect(out).not.toContain("SECRET-TOKEN");
			expect(out).not.toContain("acc-1");
		});
	});

	it("says a node with no credentials has none, rather than printing an empty table", async () => {
		const { out } = await run(["list", "--json"], {});
		expect(out).toMatch(/no .*account|"accounts":\s*\[\]/iu);
	});
});

describe("credential current", () => {
	it("resolves the single legacy account and names the SOURCE it came from", async () => {
		const { out, exitCode } = await run(["current", "--json"]);
		expect(exitCode).toBe(0);
		expect(out).toContain("node-default");
	});

	it("REFUSES with model_credential_ambiguous when two accounts and no binding", async () => {
		// THE CATALOG IS NOT IN THE SILO (D2: "Silo stores the secret envelope … A separate
		// non-secret catalog stores the descriptor"). It lives at `.refarm/model-accounts.json`, so
		// this test injects it through `catalogOf`, not through tokens.
		const { out, exitCode } = await run(
			["current", "--provider", "github-copilot", "--json"],
			{ oauthCredentials: { "github-copilot": { access: "A" } } },
			[
				{
					credentialId: "model-account:AAAAAAAAAAAAAAAAAAAAAAAAAA",
					provider: "github-copilot",
					alias: "corporativa",
					identity: { status: "unverified" },
					secretRef: "model/github-copilot-corp",
					health: "healthy",
					revision: "sha256:r1",
				},
			],
			["model/github-copilot", "model/github-copilot-corp"],
		);
		expect(exitCode).toBe(1);
		expect(out).toContain("model_credential_ambiguous");
		expect(out).not.toContain("SECRET");
	});
});

describe("credential bind", () => {
	it("refuses to bind a workspace to an account that does not exist", async () => {
		const { out, exitCode } = await run(["bind", "rcdc5", "model-account:NOPE", "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/model_credential_none/u);
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -C apps/refarm exec vitest run src/commands/credential.test.ts`
Expected: FAIL — `Failed to resolve import "./credential.js"`.

- [ ] **Step 4: Write `apps/refarm/src/commands/credential.ts`**

```ts
/**
 * `refarm credential` — which model accounts this node holds, which one a workspace spends, and
 * how to bind them.
 *
 * A PROJECTION, NEVER A SECOND RESOLVER. D3 puts model-account resolution below every operator
 * surface: this command submits the same inputs any other surface would and prints what comes back.
 * It implements no precedence of its own, which is what makes `ask`, `chat` and this agree by
 * construction rather than by review.
 *
 * NOTHING PRINTED HERE IS A SECRET. Descriptors carry a `secretRef` — a location, never material —
 * and the listing is built from `listSecretDescriptors`, not from Silo's value-returning
 * `listSecrets` (D2).
 */
import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	isRefusal,
	readLegacyCredentials,
	reconcileCatalog,
	resolveModelAccount,
	upsertDescriptor,
	type ModelAccountBinding,
	type ModelAccountDescriptor,
} from "@refarm.dev/model-account-contract-v1";
import { SiloCore } from "@refarm.dev/silo";

import { emitCommandRefusal } from "./command-refusal.js";

export const CATALOG_FILE = ".refarm/model-accounts.json";

interface CredentialDeps {
	homeOf: () => string;
	siloOf: () => { loadTokens(): Promise<unknown>; saveTokens(t: Record<string, unknown>): Promise<unknown> };
	catalogOf: () => ModelAccountDescriptor[];
	secretRefsOf: () => string[];
	bindingsOf: () => ModelAccountBinding[];
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function defaultDeps(): CredentialDeps {
	const homeOf = () => process.env.HOME ?? "";
	return {
		homeOf,
		siloOf: () => new SiloCore(),
		catalogOf: () => readJson<ModelAccountDescriptor[]>(path.join(homeOf(), CATALOG_FILE), []),
		// S0 reads the legacy layout: one secret per provider, at `model/<provider>`. The real
		// listing lands with the first write, which is S1/S2 work.
		secretRefsOf: () => [],
		bindingsOf: () =>
			Object.entries(
				readJson<{ modelBindings?: Record<string, string> }>(
					path.join(homeOf(), ".refarm", "config.json"),
					{},
				).modelBindings ?? {},
			).map(([workspaceId, credentialId]) => ({ workspaceId, credentialId })),
	};
}

/** REFUSALS, NOT ESCAPING EXCEPTIONS — `cli-refusal-conformance` probes every command. */
function guarded(
	operation: string,
	options: { json?: boolean },
	body: () => Promise<void> | void,
): Promise<void> | void {
	const fail = (error: unknown) =>
		emitCommandRefusal({
			command: "credential",
			operation,
			options,
			error: `credential-${operation}-refused`,
			message: error instanceof Error ? error.message : String(error),
			nextAction: "Run `refarm credential --help` to see the accepted arguments.",
			nextCommands: ["refarm credential --help"],
		});
	try {
		const result = body();
		return result instanceof Promise ? result.catch(fail) : result;
	} catch (error) {
		fail(error);
	}
}

/** SAFE. The only fields that may leave this command. */
const safeRow = (entry: ModelAccountDescriptor) => ({
	credentialId: entry.credentialId,
	provider: entry.provider,
	alias: entry.alias,
	health: entry.health,
	identity: entry.identity.status,
	revision: entry.revision,
});

export function createCredentialCommand(deps: CredentialDeps = defaultDeps()): Command {
	const credential = new Command("credential").description(
		"Model accounts this node holds, and which one a workspace spends",
	);

	/** Legacy readers plus the stored catalog, reconciled against the secrets that exist. */
	const loadAccounts = async (): Promise<ModelAccountDescriptor[]> => {
		const tokens = (await deps.siloOf().loadTokens()) as Record<string, unknown>;
		const legacy = readLegacyCredentials(tokens);
		const stored = deps.catalogOf();
		const merged = stored.reduce<ModelAccountDescriptor[]>(
			(acc, entry) => upsertDescriptor(acc, entry),
			legacy,
		);
		const refs = deps.secretRefsOf();
		// A node with no listing yet must not have every account read as `incomplete`: with nothing
		// measured, the descriptors' own refs are the best available statement, and the listing
		// replaces this the moment it exists.
		return reconcileCatalog(merged, refs.length > 0 ? refs : merged.map((e) => e.secretRef));
	};

	credential
		.command("list")
		.description("Every model account this node holds — ids, aliases and health, never secrets")
		.option("--json", "Output machine-readable result")
		.action(async (options: { json?: boolean }) =>
			guarded("list", options, async () => {
				const accounts = (await loadAccounts()).map(safeRow);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({ command: "credential", operation: "list", extra: { accounts } }),
					);
					return;
				}
				if (accounts.length === 0) {
					process.stdout.write("no model account is registered on this node\n  refarm sow\n");
					return;
				}
				process.stdout.write(
					accounts
						.map(
							(a) =>
								`  ${a.provider.padEnd(16)} ${a.alias.padEnd(14)} ${a.health.padEnd(10)} ${a.identity}\n`,
						)
						.join(""),
				);
			}),
		);

	credential
		.command("current")
		.description("Which account a dispatch would spend, and why that one")
		.option("--json", "Output machine-readable result")
		.option("--provider <id>", "Resolve for this provider")
		.option("--workspace <id>", "Resolve as this workspace would")
		.action(async (options: { json?: boolean; provider?: string; workspace?: string }) =>
			guarded("current", options, async () => {
				const accounts = await loadAccounts();
				const provider = options.provider ?? accounts[0]?.provider;
				if (!provider) throw new Error("no model account is registered on this node");
				const result = resolveModelAccount({
					provider,
					accounts,
					bindings: deps.bindingsOf(),
					workspaceId: options.workspace ?? null,
				});
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "credential",
							operation: "current",
							extra: { result },
						}),
					);
				} else if (isRefusal(result)) {
					process.stdout.write(
						`${result.code}: ${result.message}\n` +
							result.candidates.map((c) => `  ${c.alias}  ${c.credentialId}\n`).join(""),
					);
				} else {
					process.stdout.write(
						`${result.provider} · ${result.credentialAlias} · via ${result.source}\n`,
					);
				}
				// NON-ZERO ON REFUSAL, so this can be a gate rather than a report.
				if (isRefusal(result)) process.exitCode = 1;
			}),
		);

	credential
		.command("bind")
		.argument("<workspace>", "Workspace id, as declared in .refarm/config.json")
		.argument("<credentialId>", "The OPAQUE id — never the alias, which may be renamed")
		.description("Bind a workspace to one model account")
		.option("--json", "Output machine-readable result")
		.action(async (workspace: string, credentialId: string, options: { json?: boolean }) =>
			guarded("bind", options, async () => {
				const accounts = await loadAccounts();
				if (!accounts.some((a) => a.credentialId === credentialId && a.health === "healthy")) {
					throw new Error(
						`model_credential_none: no eligible account on this node carries the id ${credentialId}`,
					);
				}
				const configPath = path.join(deps.homeOf(), ".refarm", "config.json");
				const config = readJson<Record<string, unknown>>(configPath, {});
				const bindings = { ...((config.modelBindings as Record<string, string>) ?? {}) };
				bindings[workspace] = credentialId;
				fs.writeFileSync(
					configPath,
					`${JSON.stringify({ ...config, modelBindings: bindings }, null, 2)}\n`,
				);
				const extra = { workspace, credentialId };
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({ command: "credential", operation: "bind", extra }),
					);
				} else {
					process.stdout.write(`${workspace} → ${credentialId}\n`);
				}
			}),
		);

	return credential;
}

export const credentialCommand = createCredentialCommand();
```

Two things the executor must not "improve":

- **`bind` persists the opaque id, never the alias** (D2). An alias may be renamed and every binding
  written against it would silently point at nothing, or worse, at whatever took the name.
- **`current` exits non-zero on refusal.** A refusal that exits 0 cannot be a gate, and the whole
  reason `model_credential_ambiguous` exists is to stop a dispatch.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C apps/refarm exec vitest run src/commands/credential.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Register and probe**

In `apps/refarm/src/program.ts`, beside `program.addCommand(nodeCommand);`:

```ts
import { credentialCommand } from "./commands/credential.js";
// …
program.addCommand(credentialCommand);
```

In `scripts/directory-independence.mjs`, add to `PROBE_COMMANDS`:

```js
	{
		name: "credential list",
		argv: ["credential", "list", "--json"],
		scope: "node",
		scopeReason:
			"Which model accounts this node holds is a fact about the node's silo and catalog, never about the shell that asked. A cwd-dependent listing would let a workspace resolve a different account depending on where the operator was standing, which is the exact class of silent quota crossover the account contract exists to prevent.",
	},
```

`credential current` and `credential bind` take arguments or mutate, so the derived exclusion rules
cover them — **do not** add them to `directory-independence-exclusions.mjs`; `probe-coverage`
rejects a declared exclusion that a derived rule already covers.

- [ ] **Step 7: Run every gate**

```bash
pnpm --filter @refarm.dev/refarm run type-check
pnpm --filter @refarm.dev/refarm run build
pnpm -C apps/refarm exec vitest run
node scripts/directory-independence.mjs
node apps/refarm/dist/index.js credential list
```
Expected: all pass; `credential list` shows the operator's `openai-codex` account as
`default / unverified / healthy`, with no secret in the output.

- [ ] **Step 8: Commit**

```bash
git add apps/refarm/src/commands/credential.ts apps/refarm/src/commands/credential.test.ts \
        apps/refarm/src/program.ts apps/refarm/package.json scripts/directory-independence.mjs pnpm-lock.yaml
git commit -m "feat(credential): list, resolve and bind model accounts without ever printing one"
```

---

## Task 6: Retire the interim guard's refusal — **BLOCKED, and the plan was wrong**

**Status 2026-08-13: attempted, reverted, and it must not be attempted again until the login writes
to the catalog.**

The reasoning below is sound and its premise is false. It says a `different-account` write "goes to
a different key and destroys nothing" — but **nothing writes to the catalog in S0**. Measured after
tasks 1–5 landed: `sow.ts` still writes `oauthCredentials: { ...existing, [provider]: creds }`, one
slot per provider, and `.refarm/model-accounts.json` is only ever READ (`catalogOf`). The catalog
write is S1/S2 work, named in this plan's own debt #1.

So removing the refusal now would restore exactly the destruction `73692b05` closed — on the
operator's node, for the account pair he is preparing to add. The change was made, measured, and
reverted before commit.

**The real precondition:** a login that produces a catalog entry and a namespaced secret. When that
lands, this task becomes correct as written, and the assertion to add is not only the message change
— it is *two accounts of one provider stored, and the first still readable after the second login*.

The original reasoning, kept because it is what to do once the precondition holds:

**Files:**
- Modify: `apps/refarm/src/commands/sow.ts`, `apps/refarm/src/credentials/credential-account.ts`
- Test: `apps/refarm/src/credentials/credential-account.test.ts`

**Interfaces:** no new exports. `compareStoredAccount` keeps all four states.

- [ ] **Step 1: Update the tests to pin the new meaning**

`73692b05` refuses a `different-account` login because the write destroyed the stored credential.
Once the catalog exists, a second account is a second entry and destroys nothing, so a refusal that
no longer describes a real risk must go — a warning kept past its cause is how warnings stop being
read.

In `apps/refarm/src/credentials/credential-account.test.ts`, change the `describeAccountVerdict`
expectation for `different-account` from naming `--replace-account` to naming the account it is
adding, and add:

```ts
	it("reads a second account as INFORMATION now that it destroys nothing", () => {
		// The guard's job shrank because the defect did. `different-account` is still detected and
		// still reported — it is simply no longer a refusal, because the catalog gives it its own
		// entry instead of overwriting the first.
		const message = describeAccountVerdict(
			{ kind: "different-account", stored: "pessoal", incoming: "corporativa" },
			"github-copilot",
		);
		expect(message).toContain("corporativa");
		expect(message).not.toMatch(/destroy|--replace-account/iu);
	});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/refarm exec vitest run src/credentials/credential-account.test.ts`
Expected: FAIL on the `--replace-account` assertions.

- [ ] **Step 3: Make the change**

In `credential-account.ts`, rewrite the `different-account` branch to report rather than warn about
destruction. In `sow.ts`, delete the `emitCommandRefusal` block and the `!opts.replaceAccount`
condition; keep printing the notice. Keep `--replace-account` and narrow its help text to the
`unknown` case (replacing a legacy entry that does not record its account).

- [ ] **Step 4: Run the tests and the parity gate**

```bash
pnpm -C apps/refarm exec vitest run src/credentials/credential-account.test.ts src/commands/sow.test.ts test/lazy-command-parity.test.ts
pnpm --filter @refarm.dev/refarm run build   # the parity gate drives the BUILT CLI
pnpm -C apps/refarm exec vitest run test/lazy-command-parity.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/refarm/src/commands/sow.ts apps/refarm/src/credentials/credential-account.ts apps/refarm/src/credentials/credential-account.test.ts
git commit -m "refactor(sow): a second account is news, not a refusal"
```

---

## Exit criteria for S0

From the spec, verbatim: *"two same-provider fixtures resolve deterministically per workspace;
ambiguity refuses."* Both are covered by Task 2's suite. The acceptance rows this slice closes:

| row | task |
| --- | --- |
| login alias `blue`, then `account-03` → both usable | 3 |
| re-login `account-03` → `blue` unchanged | 3 |
| rename `blue` to `client-x` → id, binding, secret, history unchanged | 3 |
| descriptor without secret → incomplete, ineligible, never "healthy" | 3, 2 |
| secret without descriptor → unclaimed, redacted, needs repair | 3 (both primitives), 2 |
| credential listing returns ids/aliases/protection only | 5 |
| workspace `rcdc5` / `refarm` resolve their own bindings without cwd | 2 |
| two accounts, no binding → `model_credential_ambiguous` | 2 |
| logs/status export carry safe credential id only | 1, 5 |

## Debts this slice leaves, stated rather than discovered

1. **No secret is written under the new key yet.** S0 reads; the first write happens when a login
   produces a catalog entry, which is S1/S2 work. Until then the operator's silo is untouched —
   **and the one-slot destruction is still real**, which is why task 6 is blocked and the interim
   guard from `73692b05` stays in force. This debt is load-bearing, not cosmetic: it is the whole
   reason a second Copilot login is still refused rather than merely reported.
2. **`normalizeAccountId` is unmeasured for Copilot.** Codex's account id is a 36-character UUID;
   Copilot's shape is unknown until a login produces one, and nothing here may assume it.
3. **The `ambiguous` path is unexercised on real hardware.** The operator has one account. It is
   proven by fixtures, and the first real test is his second Copilot login.
4. **The env override (`source: "env"`) is typed but not wired.** D3 requires it to be visible and
   one-dispatch; nothing reads `GITHUB_COPILOT_ACCESS_TOKEN` in this slice.
