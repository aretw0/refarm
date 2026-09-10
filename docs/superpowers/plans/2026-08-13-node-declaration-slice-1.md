# Node Declaration — Slice 1 Implementation Plan

**Status: IMPLEMENTED 2026-08-13.** All five tasks landed
(`da6aadff`, `17624f5c`, `b94f2c4a`, `914977f0`, `3a36a5cb`), plus `947e1384` for two defects the
repo's own instruments caught after the fact: an exception escaping `parseAsync`
(`cli-refusal-conformance`) and a path traversal in `apply` (commit security review). 3453 tests pass
across 230 files. Proved end to end against the operator's real node: `declare` → `diff` aligned →
`apply` into an empty home with `ca.key` byte-identical.

Two corrections to what is written below, kept rather than edited away because the reasons matter:

- **`node apply` needs no declared probe exclusion.** It takes a required argument, so the DERIVED
  rule already covers it, and `probe-coverage` rejects a redundant declaration on purpose: derived
  exclusions re-evaluate every run and cannot go stale.
- **The artefact is ~52 KB, not 30.** Thirty kilobytes is the node's material; base64 inflates the
  sealed half by 4/3.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `refarm node declare` emits a single ~30 KB versioned file holding this node's decisions in cleartext and its identity sealed with a passphrase; `refarm node diff` reports how a node and such a file disagree; `refarm node apply` replays one onto a node.

**Architecture:** Two pure modules and one command module, mirroring the `sovereign-layout.ts` / `sovereign-export.ts` / `backup.ts` split that already exists. `node-seal.ts` is `node:crypto` and nothing else — no filesystem, no `process`. `node-declaration.ts` builds and diffs the document as data — no filesystem. `node.ts` is the only file that touches disk or prompts, exactly as `backup.ts` is today.

**Tech Stack:** TypeScript, Commander, vitest, `node:crypto` (`scrypt` + `aes-256-gcm`), `@refarm.dev/prompt-contract-v1` for the secret prompt, `@refarm.dev/capabilities/envelope` for JSON output.

**Spec:** [`docs/superpowers/specs/2026-08-13-a-node-is-thirty-kilobytes-design.md`](../specs/2026-08-13-a-node-is-thirty-kilobytes-design.md)

## Global Constraints

- **Zero new dependencies.** `node:crypto` only. Adding `age`, `sops`, or any package is out of scope and contradicts D2's measurement.
- **Protected surfaces are off limits** (CLAUDE.md §8): no edits to `.project/**`, `.github/workflows/**`, `packages/tractor/**`, `packages/tractor-ts/**`, `packages/plugin-manifest/**`. The ledger entry for ISS-123 is the operator's to authorise.
- **Run tests as `pnpm -C apps/refarm exec vitest run <file>`.** Never `pnpm --filter refarm exec vitest` — `--filter exec` runs from the repo root, outside vitest's home containment, and writes into the real `$HOME`.
- **`pnpm --filter @refarm.dev/refarm run type-check` after every task.** `build` uses `tsconfig.build.json`, which excludes tests; a broken test fixture is invisible to `build` and only `type-check` sees it.
- **Three states, never two.** Every read that can fail differently reports which. A boolean where three answers exist is the defect this whole area was built to remove.
- **Never print a secret.** Names and byte counts only, in output and in test assertions.
- **scrypt parameters are fixed:** `N=131072 (2^17), r=8, p=1, keyLength=32`, and `maxmem: 256 * 1024 * 1024` **must** be passed. Node's default `maxmem` is 32 MiB; these parameters need `128 * N * r` = 128 MiB and throw `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` without it. Measured 2026-08-13: 291 ms per derivation.
- **Commit after every task.** `refarm agent finish --lane after-edit --run --json` before committing, `--lane after-commit --run --json` after.

---

## File Structure

| file | responsibility |
| --- | --- |
| `apps/refarm/src/commands/node-seal.ts` (create) | PURE. Seal/unseal a payload; report what a seal *is* without opening it. No filesystem. |
| `apps/refarm/src/commands/node-seal.test.ts` (create) | Round-trip, wrong passphrase, unknown custody, tamper detection. |
| `apps/refarm/src/commands/node-declaration.ts` (create) | PURE. Which paths are sealed; build the document; diff a node against one. No filesystem. |
| `apps/refarm/src/commands/node-declaration.test.ts` (create) | Sealed-path selection, all four key verdicts, `uncomparable`. |
| `apps/refarm/src/commands/node.ts` (create) | The Commander command. The only file here that reads disk or prompts. |
| `apps/refarm/src/commands/node.test.ts` (create) | Command behaviour against a synthetic home. |
| `apps/refarm/src/program.ts` (modify) | Register `nodeCommand` eagerly, beside `backupCommand` at line 286. |
| `scripts/directory-independence.mjs` (modify) | Add `node declare` to `PROBE_COMMANDS`. |
| `scripts/directory-independence-exclusions.mjs` (modify) | Declare `node apply` as a mutator. |
| `apps/refarm/src/commands/backup.ts` (modify) | One line in `plan`'s human output pointing at the other command. |

---

## Task 1: The seal

**Files:**
- Create: `apps/refarm/src/commands/node-seal.ts`
- Test: `apps/refarm/src/commands/node-seal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SealEnvelope`, `SealState`, `KNOWN_CUSTODIES`, `sealPayload(payload: unknown, passphrase: string): SealEnvelope`, `unsealPayload(envelope: SealEnvelope, passphrase: string): unknown`, `readSealState(envelope: unknown): SealState`, `SealRefusalError`.

- [ ] **Step 1: Write the failing tests**

Create `apps/refarm/src/commands/node-seal.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { readSealState, sealPayload, SealRefusalError, unsealPayload } from "./node-seal.js";

const PAYLOAD = { files: { ".refarm/tls/ca.key": "QSBLRVk=" } };

describe("sealPayload / unsealPayload", () => {
	it("round-trips a payload through the passphrase", () => {
		const sealed = sealPayload(PAYLOAD, "correct horse battery staple");
		expect(unsealPayload(sealed, "correct horse battery staple")).toEqual(PAYLOAD);
	});

	it("puts NO plaintext of the payload in the envelope", () => {
		// The whole promise of the format, asserted against the serialised envelope rather than
		// against field names: a key that moves or nests must not leak the bytes.
		const serialised = JSON.stringify(sealPayload(PAYLOAD, "pw"));
		expect(serialised).not.toContain("QSBLRVk=");
		expect(serialised).not.toContain("ca.key");
	});

	it("keeps custody, kdf and cipher in CLEARTEXT so an old file can explain itself", () => {
		const sealed = sealPayload(PAYLOAD, "pw");
		expect(sealed.custody).toBe("passphrase");
		expect(sealed.cipher).toBe("aes-256-gcm");
		expect(sealed.kdf).toEqual({ name: "scrypt", N: 131072, r: 8, p: 1 });
	});

	it("uses a fresh salt and iv per seal, so two seals of one payload differ", () => {
		const a = sealPayload(PAYLOAD, "pw");
		const b = sealPayload(PAYLOAD, "pw");
		expect(a.salt).not.toBe(b.salt);
		expect(a.iv).not.toBe(b.iv);
		expect(a.payload).not.toBe(b.payload);
	});

	it("refuses a wrong passphrase by NAME, never by stack trace", () => {
		// A GCM tag failure surfaces as "unable to authenticate data", which reads like corruption.
		// The operator's actual situation is almost always a typo, and the message must say so.
		const sealed = sealPayload(PAYLOAD, "pw");
		expect(() => unsealPayload(sealed, "wrong")).toThrow(SealRefusalError);
		expect(() => unsealPayload(sealed, "wrong")).toThrow(/passphrase/iu);
	});

	it("detects a tampered payload rather than returning altered data", () => {
		const sealed = sealPayload(PAYLOAD, "pw");
		const tampered = { ...sealed, payload: Buffer.from("not the payload").toString("base64") };
		expect(() => unsealPayload(tampered, "pw")).toThrow(SealRefusalError);
	});
});

describe("readSealState", () => {
	it("says a passphrase seal is openable by this build", () => {
		expect(readSealState(sealPayload(PAYLOAD, "pw"))).toMatchObject({
			state: "openable",
			custody: "passphrase",
		});
	});

	it("names an UNKNOWN custody as an answer, not as damage", () => {
		// The format's promise to its own future. A refarm that meets `custody: "peer"` must say what
		// it cannot do; reporting it as unreadable would send the operator hunting for corruption in
		// a file that is perfectly intact.
		const future = { ...sealPayload(PAYLOAD, "pw"), custody: "peer" };
		const state = readSealState(future);
		expect(state).toMatchObject({ state: "unknown-custody", custody: "peer" });
		expect((state as { reason: string }).reason).toMatch(/does not implement/iu);
	});

	it("separates UNREADABLE from both of the above", () => {
		for (const bad of [null, undefined, 42, {}, { custody: 7 }]) {
			expect(readSealState(bad), JSON.stringify(bad)).toMatchObject({ state: "unreadable" });
		}
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node-seal.test.ts`
Expected: FAIL — `Failed to resolve import "./node-seal.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/refarm/src/commands/node-seal.ts`:

```ts
/**
 * THE SEAL — the only cryptography in this repository, and deliberately the smallest possible.
 *
 * WHY `node:crypto` AND NOTHING ELSE. Measured 2026-08-13: there is no encryption primitive
 * anywhere in this repo. `heartwood` signs and verifies; `vault-contract-v1` is a knowledge vault.
 * Sealing with the standard library costs zero dependencies; `age` costs a binary on every machine
 * that must restore, which is the one machine you cannot make assumptions about.
 *
 * CUSTODY IS CLEARTEXT, AND THAT IS THE POINT. `custody`, `kdf` and `cipher` sit outside the
 * ciphertext so a build that cannot open a file can still SAY WHY. The operator chose the passphrase
 * as the floor and asked, in as many words, that better custodies be able to arrive later; a format
 * that could not explain an unrecognised one would strand him at exactly that moment.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export const SEAL_CIPHER = "aes-256-gcm";

/**
 * `maxmem` IS NOT OPTIONAL. These parameters need `128 * N * r` = 128 MiB; Node's default cap is
 * 32 MiB and `scryptSync` throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` without this. Measured
 * 2026-08-13: 291 ms per derivation, paid once per declare and once per apply.
 */
export const SCRYPT_PARAMS = { name: "scrypt", N: 131072, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const KEY_BYTES = 32;

/** Custodies THIS build can open. A value outside this list is a newer refarm's, not an error. */
export const KNOWN_CUSTODIES = ["passphrase"] as const;

export interface SealEnvelope {
	readonly custody: string;
	readonly kdf: { readonly name: string; readonly N: number; readonly r: number; readonly p: number };
	readonly cipher: string;
	readonly salt: string;
	readonly iv: string;
	readonly tag: string;
	readonly payload: string;
}

/** THREE STATES. "I cannot open this" and "this is not a seal" are different sentences. */
export type SealState =
	| { readonly state: "openable"; readonly custody: string }
	| { readonly state: "unknown-custody"; readonly custody: string; readonly reason: string }
	| { readonly state: "unreadable"; readonly reason: string };

/** A refusal the command layer can render as a sentence instead of a stack trace. */
export class SealRefusalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SealRefusalError";
	}
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
	return scryptSync(passphrase, salt, KEY_BYTES, { ...SCRYPT_PARAMS, maxmem: SCRYPT_MAXMEM });
}

/** PURE apart from randomness. Seals a payload under a passphrase. */
export function sealPayload(payload: unknown, passphrase: string): SealEnvelope {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const cipher = createCipheriv(SEAL_CIPHER, deriveKey(passphrase, salt), iv);
	const sealed = Buffer.concat([
		cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
		cipher.final(),
	]);
	return {
		custody: "passphrase",
		kdf: SCRYPT_PARAMS,
		cipher: SEAL_CIPHER,
		salt: salt.toString("base64"),
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		payload: sealed.toString("base64"),
	};
}

/** PURE. Opens a passphrase seal, or refuses by name. */
export function unsealPayload(envelope: SealEnvelope, passphrase: string): unknown {
	const decipher = createDecipheriv(
		SEAL_CIPHER,
		deriveKey(passphrase, Buffer.from(envelope.salt, "base64")),
		Buffer.from(envelope.iv, "base64"),
	);
	decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
	try {
		const opened = Buffer.concat([
			decipher.update(Buffer.from(envelope.payload, "base64")),
			decipher.final(),
		]);
		return JSON.parse(opened.toString("utf8"));
	} catch {
		// GCM cannot tell a wrong key from altered bytes, so this says both and leads with the one
		// that is nearly always true.
		throw new SealRefusalError(
			"the seal did not open: the passphrase is wrong, or the file has been altered since it was sealed",
		);
	}
}

/** PURE. What a seal is, WITHOUT opening it. */
export function readSealState(envelope: unknown): SealState {
	const seal = envelope as Partial<SealEnvelope> | null | undefined;
	if (!seal || typeof seal !== "object" || typeof seal.custody !== "string") {
		return { state: "unreadable", reason: "not a seal: no custody is declared" };
	}
	if (!(KNOWN_CUSTODIES as readonly string[]).includes(seal.custody)) {
		return {
			state: "unknown-custody",
			custody: seal.custody,
			reason: `sealed by custody "${seal.custody}", which this build does not implement — use a refarm that does`,
		};
	}
	if (typeof seal.payload !== "string" || typeof seal.salt !== "string" || typeof seal.iv !== "string") {
		return { state: "unreadable", reason: "a passphrase seal is missing its salt, iv or payload" };
	}
	return { state: "openable", custody: seal.custody };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node-seal.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/refarm run type-check
node apps/refarm/dist/index.js agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/node-seal.ts apps/refarm/src/commands/node-seal.test.ts
git commit -m "feat(node): a seal that can say why it will not open"
```

---

## Task 2: The declaration document and its diff

**Files:**
- Create: `apps/refarm/src/commands/node-declaration.ts`
- Test: `apps/refarm/src/commands/node-declaration.test.ts`

**Interfaces:**
- Consumes: `SealEnvelope`, `readSealState` from Task 1; `classifyByLayout` from `./sovereign-layout.js`.
- Produces: `NodeDeclaration`, `KeyVerdict`, `DeclarationDiff`, `isSealedPath(relative: string): boolean`, `isCarriedByDeclaration(relative: string): boolean`, `summariseNotCarried(files: readonly { relative: string; bytes: number }[]): NodeDeclaration["notCarried"]`, `buildDeclaration(input: BuildDeclarationInput): NodeDeclaration`, `diffDeclarations(nodeConfig: Record<string, unknown>, declaration: NodeDeclaration): DeclarationDiff`.

- [ ] **Step 1: Write the failing tests**

Create `apps/refarm/src/commands/node-declaration.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
	buildDeclaration,
	diffDeclarations,
	isSealedPath,
	summariseNotCarried,
} from "./node-declaration.js";
import { sealPayload } from "./node-seal.js";

const CONFIG = { node: { name: "n1" }, surfaces: { web: { port: 3000 } }, workspaces: {} };

const declaration = (overrides: Partial<Parameters<typeof buildDeclaration>[0]> = {}) =>
	buildDeclaration({
		nodeName: "n1",
		declaredAt: "2026-08-13T00:00:00Z",
		governance: "local",
		config: CONFIG,
		authPolicy: null,
		seal: sealPayload({ files: {} }, "pw"),
		reAuthenticate: ["github"],
		notCarried: { history: 8, storage: 4, bytes: 575815, replicates: true },
		...overrides,
	});

describe("isSealedPath", () => {
	it("seals identity AND its secrets, so a restored node is trusted by its old peers", () => {
		// The certificate is public and the key is not, but they are useless apart: a node with a CA
		// key and no CA certificate cannot present the identity the key proves.
		for (const file of [
			".refarm/node-id",
			".refarm/node.json",
			".refarm/tls/ca.key",
			".refarm/tls/ca.crt",
			".refarm/tls/ca.cnf",
			".refarm/delivery/telegram.token",
		]) {
			expect(isSealedPath(file), file).toBe(true);
		}
	});

	it("leaves the DECISIONS in cleartext, which is the whole readability of the file", () => {
		expect(isSealedPath(".refarm/config.json")).toBe(false);
		expect(isSealedPath(".refarm/auth-policy.json")).toBe(false);
	});

	it("does not seal history or storage — the declaration never carries them at all", () => {
		expect(isSealedPath(".refarm/task-memory.db")).toBe(false);
		expect(isSealedPath(".refarm/data/refarm/default.db")).toBe(false);
	});
});

describe("summariseNotCarried", () => {
	it("counts history and storage APART, because they are lost for different reasons", () => {
		// History is gone for good: nothing reproduces a record of the past. Storage is expected back
		// by replication. Collapsing them into one number would hide which of the two an operator is
		// actually looking at, and only one of them has a remedy.
		expect(
			summariseNotCarried([
				{ relative: ".refarm/config.json", bytes: 4962 },      // a decision — carried
				{ relative: ".refarm/tls/ca.crt", bytes: 1200 },       // sealed — carried
				{ relative: ".refarm/task-memory.db", bytes: 200 },    // history
				{ relative: ".refarm/sas/verification-log.ndjson", bytes: 100 },
				{ relative: ".refarm/data/refarm/default.db", bytes: 900 },   // storage
				{ relative: ".local/share/refarm/default.peer", bytes: 50 },
			]),
		).toEqual({ history: 2, storage: 2, bytes: 1250, replicates: true });
	});

	it("counts nothing as not-carried when everything is a decision or sealed", () => {
		expect(
			summariseNotCarried([
				{ relative: ".refarm/config.json", bytes: 10 },
				{ relative: ".refarm/node-id", bytes: 6 },
			]),
		).toEqual({ history: 0, storage: 0, bytes: 0, replicates: true });
	});
});

describe("buildDeclaration", () => {
	it("carries the config VERBATIM rather than re-encoding it", () => {
		// A translation would be a second vocabulary, and a second vocabulary rots against the first
		// the day someone adds a key. The declaration is a container.
		expect(declaration().declarations).toEqual(CONFIG);
	});

	it("names credentials to re-obtain and carries none of them", () => {
		const built = declaration();
		expect(built.reAuthenticate).toEqual(["github"]);
		expect(JSON.stringify(built)).not.toContain("gho_");
	});

	it("records what it did NOT carry, so the file cannot read as complete", () => {
		expect(declaration().notCarried).toEqual({
			history: 8,
			storage: 4,
			bytes: 575815,
			replicates: true,
		});
	});
});

describe("diffDeclarations", () => {
	it("returns all four per-key verdicts", () => {
		const diff = diffDeclarations(
			{ node: { name: "n1" }, surfaces: { web: { port: 4000 } }, processes: {} },
			declaration(),
		);
		const verdict = (key: string) => diff.keys.find((entry) => entry.key === key)?.verdict;
		expect(verdict("node")).toBe("aligned");
		expect(verdict("surfaces")).toBe("divergent");
		expect(verdict("processes")).toBe("node-only");
		expect(verdict("workspaces")).toBe("source-only");
	});

	it("calls identity UNCOMPARABLE when the seal cannot be opened by this build", () => {
		// The third state that stops the presence-read-as-health defect from returning. Reporting
		// `aligned` for the cleartext half while silently skipping the sealed half would claim an
		// agreement nothing established.
		const future = declaration();
		const diff = diffDeclarations(CONFIG, {
			...future,
			seal: { ...future.seal, custody: "peer" },
		});
		expect(diff.identity).toBe("uncomparable");
		expect(diff.aligned).toBe(false);
	});

	it("is aligned only when every key agrees AND identity is comparable", () => {
		const diff = diffDeclarations(CONFIG, declaration());
		expect(diff.keys.every((entry) => entry.verdict === "aligned")).toBe(true);
		expect(diff.aligned).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node-declaration.test.ts`
Expected: FAIL — `Failed to resolve import "./node-declaration.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/refarm/src/commands/node-declaration.ts`:

```ts
/**
 * THE DECLARATION — a node as thirty kilobytes of readable decisions plus a sealed identity.
 *
 * Measured on the operator's node 2026-08-13: of 592 KB of irrecoverable state, the entire DECISION
 * surface is 5.5 KB and identity is 24.5 KB. History and storage are the other 95%, and no
 * declaration reproduces a record of the past. This module builds the 30 KB and refuses the rest.
 *
 * `declarations` IS `.refarm/config.json`, byte for byte. Not a projection of it, not a subset:
 * a re-encoding would be a second vocabulary, and `2026-07-31-declaring-is-authoring-design.md`
 * A2 forbids a second source of truth for exactly the reason it would rot.
 */
import { classifyByLayout } from "./sovereign-layout.js";
import { readSealState, type SealEnvelope } from "./node-seal.js";

/** Identity-bearing locations. Sealed even when the layout calls them `data`, because a certificate
 *  without its key restores a node that cannot present the identity it claims. */
const SEALED_EXACT = [".refarm/node-id", ".refarm/node.json"];
const SEALED_PREFIXES = [".refarm/tls/"];

/** PURE. Whether a path relative to the node home belongs inside the seal. */
export function isSealedPath(relative: string): boolean {
	const normalised = relative.split(/[\\/]/u).join("/");
	if (SEALED_EXACT.includes(normalised)) return true;
	if (SEALED_PREFIXES.some((prefix) => normalised.startsWith(prefix))) return true;
	// Declared namespaces are irrelevant here: nothing storage-shaped is ever sealed, so an empty
	// list cannot change the answer.
	return classifyByLayout(normalised, []).nature === "secret";
}

/** The two files the declaration carries in CLEARTEXT. Everything else is sealed or not carried. */
const DECISION_FILES = [".refarm/config.json", ".refarm/auth-policy.json"];
const STORAGE_DIRECTORIES = [".refarm/data/refarm/", ".local/share/refarm/"];

/** PURE. Whether the declaration carries this path at all, sealed or in the clear. */
export function isCarriedByDeclaration(relative: string): boolean {
	const normalised = relative.split(/[\\/]/u).join("/");
	return DECISION_FILES.includes(normalised) || isSealedPath(normalised);
}

/**
 * PURE. What the declaration leaves behind, counted by WHY it is left behind.
 *
 * History and storage are separated deliberately. History is gone for good — nothing reproduces a
 * record of the past. Storage is expected back by replication. One number covering both would tell
 * an operator how much he lost without telling him which half has a remedy.
 */
export function summariseNotCarried(
	files: readonly { relative: string; bytes: number }[],
): NodeDeclaration["notCarried"] {
	const left = files.filter((file) => !isCarriedByDeclaration(file.relative));
	const isStorage = (relative: string) =>
		STORAGE_DIRECTORIES.some((dir) => relative.split(/[\\/]/u).join("/").startsWith(dir));
	return {
		history: left.filter((file) => !isStorage(file.relative)).length,
		storage: left.filter((file) => isStorage(file.relative)).length,
		bytes: left.reduce((total, file) => total + file.bytes, 0),
		replicates: true,
	};
}

export interface NodeDeclaration {
	readonly $schema: "refarm/node-declaration.v1";
	readonly node: { readonly name: string; readonly declaredAt: string };
	readonly governance: "local" | "repo";
	readonly declarations: Record<string, unknown>;
	readonly authPolicy: Record<string, unknown> | null;
	readonly seal: SealEnvelope;
	readonly reAuthenticate: readonly string[];
	readonly notCarried: {
		readonly history: number;
		readonly storage: number;
		readonly bytes: number;
		readonly replicates: boolean;
	};
}

export interface BuildDeclarationInput {
	readonly nodeName: string;
	readonly declaredAt: string;
	readonly governance: "local" | "repo";
	readonly config: Record<string, unknown>;
	readonly authPolicy: Record<string, unknown> | null;
	readonly seal: SealEnvelope;
	readonly reAuthenticate: readonly string[];
	readonly notCarried: NodeDeclaration["notCarried"];
}

/** PURE. The document. Every field is supplied — this module reads nothing. */
export function buildDeclaration(input: BuildDeclarationInput): NodeDeclaration {
	return {
		$schema: "refarm/node-declaration.v1",
		node: { name: input.nodeName, declaredAt: input.declaredAt },
		governance: input.governance,
		declarations: input.config,
		authPolicy: input.authPolicy,
		seal: input.seal,
		reAuthenticate: [...input.reAuthenticate],
		notCarried: input.notCarried,
	};
}

/**
 * FOUR VERDICTS PER KEY, NEVER A BOOLEAN — and the vocabulary is chosen for the slice that has not
 * been built yet. Under `governance: "local"` a `node-only` key is pending emission; under `"repo"`
 * the same key is an unpromoted proposal. `refarm node promote` needs that distinction to exist
 * before it can be additive, which is why it is here now with only one consumer.
 */
export type KeyVerdict = "aligned" | "node-only" | "source-only" | "divergent";

export interface DeclarationDiff {
	readonly keys: readonly { readonly key: string; readonly verdict: KeyVerdict }[];
	/** `uncomparable` when the seal cannot be opened by this build — NOT `aligned`. */
	readonly identity: "aligned" | "divergent" | "uncomparable";
	readonly aligned: boolean;
}

/** PURE. How a node's live config and a declaration disagree. */
export function diffDeclarations(
	nodeConfig: Record<string, unknown>,
	declaration: NodeDeclaration,
): DeclarationDiff {
	const source = declaration.declarations ?? {};
	const keys = [...new Set([...Object.keys(nodeConfig), ...Object.keys(source)])].sort();
	const verdicts = keys.map((key) => {
		const onNode = Object.hasOwn(nodeConfig, key);
		const inSource = Object.hasOwn(source, key);
		if (onNode && !inSource) return { key, verdict: "node-only" as const };
		if (!onNode && inSource) return { key, verdict: "source-only" as const };
		const same = JSON.stringify(nodeConfig[key]) === JSON.stringify(source[key]);
		return { key, verdict: same ? ("aligned" as const) : ("divergent" as const) };
	});
	// Identity is not compared here — this module never reads the node's key files. `uncomparable`
	// is the honest answer whenever the seal cannot be opened; a build that CAN open it compares in
	// the command layer, where the files are.
	const sealState = readSealState(declaration.seal);
	const identity = sealState.state === "openable" ? ("aligned" as const) : ("uncomparable" as const);
	return {
		keys: verdicts,
		identity,
		aligned: verdicts.every((entry) => entry.verdict === "aligned") && identity === "aligned",
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node-declaration.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/refarm run type-check
node apps/refarm/dist/index.js agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/node-declaration.ts apps/refarm/src/commands/node-declaration.test.ts
git commit -m "feat(node): the declaration document, and a diff that admits what it cannot see"
```

---

## Task 3: `refarm node declare`

**Files:**
- Create: `apps/refarm/src/commands/node.ts`
- Test: `apps/refarm/src/commands/node.test.ts`
- Modify: `apps/refarm/src/program.ts` (import beside line 6, `addCommand` beside line 286)
- Modify: `scripts/directory-independence.mjs` (`PROBE_COMMANDS`, beside the `backup plan` entry at line 379)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2; `surveyHome`, `nodeNamespaces`, `readSiloSplit` from `./backup.js`; `createStdioOperatorChannel` from `@refarm.dev/prompt-contract-v1`.
- Produces: `createNodeCommand(homeOf?: () => string, channelOf?: () => OperatorChannel): Command`, `nodeCommand`, `resolvePassphrase(...)`, `collectSealedFiles(home: string): { relative: string; base64: string }[]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/refarm/src/commands/node.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { afterEach, describe, expect, it } from "vitest";

import { collectSealedFiles, createNodeCommand } from "./node.js";

const homes: string[] = [];

function syntheticHome(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-node-"));
	homes.push(home);
	fs.mkdirSync(path.join(home, ".refarm", "tls"), { recursive: true });
	fs.writeFileSync(
		path.join(home, ".refarm", "config.json"),
		JSON.stringify({ node: { name: "n1" }, surfaces: { web: { port: 3000 } } }),
	);
	fs.writeFileSync(path.join(home, ".refarm", "node-id"), "node-1");
	fs.writeFileSync(path.join(home, ".refarm", "tls", "ca.key"), "PRIVATE-CA-KEY");
	fs.writeFileSync(path.join(home, ".refarm", "tls", "ca.crt"), "PUBLIC-CA-CERT");
	return home;
}

afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

describe("collectSealedFiles", () => {
	it("collects identity and its key, and nothing that is a decision", () => {
		const home = syntheticHome();
		const collected = collectSealedFiles(home).map((file) => file.relative).sort();
		expect(collected).toEqual([".refarm/node-id", ".refarm/tls/ca.crt", ".refarm/tls/ca.key"]);
	});
});

describe("node declare", () => {
	it("previews without a passphrase and without writing anything", async () => {
		// The read-only half, and the reason this command can be probed at all: a preview that
		// demanded a passphrase could not run unattended, and a node whose declaration cannot be
		// inspected before it is sealed is a node the operator must trust blindly.
		//
		// The EMPTY answer queue is the assertion. `createScriptedOperatorChannel` throws
		// `RangeError: answer queue exhausted` on any `ask`, so a preview that ever prompted would
		// fail here rather than pass quietly.
		const home = syntheticHome();
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel([]));
		await command.parseAsync(["declare", "--json"], { from: "user" });
		expect(fs.readdirSync(home)).toEqual([".refarm"]);
	});

	it("REFUSES to declare while the layout does not describe some path", async () => {
		// The self-correcting half of the layout, carried into this command. An unregistered path
		// means a subsystem writes somewhere nobody described, which is exactly how a certificate
		// authority key sat unnoticed. Sealing a declaration while that is true would bless the gap.
		const home = syntheticHome();
		fs.mkdirSync(path.join(home, ".refarm", "nobody-declared-this"), { recursive: true });
		fs.writeFileSync(path.join(home, ".refarm", "nobody-declared-this", "x.json"), "{}");
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel(["pw", "pw"]));
		await expect(
			command.parseAsync(["declare", "--out", target, "--json"], { from: "user" }),
		).rejects.toThrow(/unregistered/iu);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("asks for the passphrase TWICE before sealing", async () => {
		// A typo at seal time makes the file permanently unopenable, and the operator would not learn
		// it until the day he needs it. Confirmation is the only moment the mistake is still free.
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const channel = createScriptedOperatorChannel(["hunter2", "hunter2"]);
		const command = createNodeCommand(() => home, () => channel);
		await command.parseAsync(["declare", "--out", target, "--json"], { from: "user" });
		expect(fs.existsSync(target)).toBe(true);
	});

	it("refuses when the two passphrases differ, and writes NOTHING", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel(["a", "b"]));
		await expect(
			command.parseAsync(["declare", "--out", target, "--json"], { from: "user" }),
		).rejects.toThrow(/did not match/iu);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("writes a file whose cleartext holds the decisions and NONE of the key bytes", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel(["pw", "pw"]));
		await command.parseAsync(["declare", "--out", target, "--json"], { from: "user" });
		const written = fs.readFileSync(target, "utf8");
		expect(written).toContain('"port": 3000');
		expect(written).not.toContain("PRIVATE-CA-KEY");
		expect(written).not.toContain("PUBLIC-CA-CERT");
	});

	it("refuses to overwrite an existing declaration without --force", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		fs.writeFileSync(target, "{}");
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel(["pw", "pw"]));
		await expect(
			command.parseAsync(["declare", "--out", target, "--json"], { from: "user" }),
		).rejects.toThrow(/--force/u);
		expect(fs.readFileSync(target, "utf8")).toBe("{}");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node.test.ts`
Expected: FAIL — `Failed to resolve import "./node.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/refarm/src/commands/node.ts`:

```ts
/**
 * `refarm node` — the node as a file you can read, commit and replay.
 *
 * This is the ONLY module in the group that touches disk or the operator. `node-seal.ts` and
 * `node-declaration.ts` are pure, in the same split `sovereign-layout.ts` / `sovereign-export.ts`
 * hold against `backup.ts`.
 *
 * `declare` WITHOUT `--out` IS READ-ONLY AND ASKS FOR NOTHING. That is what lets it be probed for
 * directory independence, and what lets an operator see the shape of his own node before deciding
 * to seal it.
 */
import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { createStdioOperatorChannel, type OperatorChannel } from "@refarm.dev/prompt-contract-v1";

import { nodeNamespaces, readSiloSplit, surveyHome } from "./backup.js";
import {
	buildDeclaration,
	isSealedPath,
	summariseNotCarried,
	type NodeDeclaration,
} from "./node-declaration.js";
import { sealPayload } from "./node-seal.js";

/** Read every file the declaration seals, as base64. Absent files are simply absent. */
export function collectSealedFiles(home: string): { relative: string; base64: string }[] {
	const collected: { relative: string; base64: string }[] = [];
	const walk = (dir: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			const relative = path.relative(home, full).split(path.sep).join("/");
			if (isSealedPath(relative)) {
				collected.push({ relative, base64: fs.readFileSync(full).toString("base64") });
			}
		}
	};
	walk(path.join(home, ".refarm"));
	return collected;
}

/**
 * Ask for a passphrase, twice when it is about to seal.
 *
 * `REFARM_NODE_PASSPHRASE` exists for automation and tests. It is read ONCE and never confirmed:
 * an environment variable cannot be typo'd twice differently, and asking a script to repeat itself
 * would be ceremony without information.
 */
export async function resolvePassphrase(
	channel: OperatorChannel,
	env: NodeJS.ProcessEnv,
	confirm: boolean,
): Promise<string> {
	const fromEnv = env.REFARM_NODE_PASSPHRASE;
	if (fromEnv) return fromEnv;
	const first = await channel.ask({ type: "secret", question: "Passphrase for this declaration:" });
	if (!confirm) return first;
	const again = await channel.ask({ type: "secret", question: "Repeat it:" });
	if (first !== again) {
		// Refused rather than retried, and refused BEFORE anything is written. A sealed file whose
		// passphrase was mistyped is indistinguishable from a corrupt one, forever.
		throw new Error("the two passphrases did not match — nothing was written");
	}
	return first;
}

function readJsonFile(file: string): Record<string, unknown> | null {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function createNodeCommand(
	homeOf = () => process.env.HOME ?? "",
	channelOf = (): OperatorChannel => createStdioOperatorChannel(),
): Command {
	const node = new Command("node").description(
		"Declare this node as one portable file, compare a node against one, and replay it",
	);

	node
		.command("declare")
		.description("Show what this node would declare, or write it sealed with --out")
		.option("--json", "Output machine-readable result")
		.option("--out <file>", "Write the sealed declaration to this path")
		.option("--force", "Overwrite an existing declaration at --out")
		.option("--governance <mode>", "Who is authoritative for this node: local or repo", "local")
		.action(async (options: {
			json?: boolean;
			out?: string;
			force?: boolean;
			governance?: string;
		}) => {
			const home = homeOf();
			const config = readJsonFile(path.join(home, ".refarm", "config.json")) ?? {};
			const authPolicy = readJsonFile(path.join(home, ".refarm", "auth-policy.json"));
			const silo = readSiloSplit(home);
			const declared = nodeNamespaces(home);
			const { plan } = surveyHome(home, declared.namespaces[0] ?? null);
			const sealedFiles = collectSealedFiles(home);
			const relativeOf = (file: string) => path.relative(home, file).split(path.sep).join("/");
			const notCarried = summariseNotCarried(
				plan.carry.map((entry) => ({ relative: relativeOf(entry.file), bytes: entry.bytes ?? 0 })),
			);
			// `undecidable` is the export plan's name for a path NO LAYOUT ENTRY COVERS. Reported in
			// the preview and refused at seal time: a declaration written over a gap in the layout is
			// a declaration that quietly excludes whatever lives in that gap.
			const unregistered = plan.undecidable.map((entry) => relativeOf(entry.file));

			if (!options.out) {
				const preview = {
					governance: options.governance ?? "local",
					decisionKeys: Object.keys(config).sort(),
					sealed: sealedFiles.map((file) => file.relative).sort(),
					reAuthenticate: silo.reAuthenticate,
					notCarried,
					unregistered,
					namespaces: declared,
				};
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({ command: "node", operation: "declare", extra: preview }),
					);
					return;
				}
				process.stdout.write(
					`Declaration preview (nothing written)\n\n` +
						`  decisions   ${preview.decisionKeys.length} key(s): ${preview.decisionKeys.join(", ") || "(none)"}\n` +
						`  sealed      ${preview.sealed.length} identity file(s)\n` +
						preview.sealed.map((file) => `                ${file}\n`).join("") +
						`  re-auth     ${silo.reAuthenticate.join(", ") || "(none)"}\n` +
						`  NOT carried ${notCarried.history} history + ${notCarried.storage} storage file(s), ` +
						`${notCarried.bytes} bytes — history is lost, storage replicates\n` +
						(unregistered.length > 0
							? `  UNREGISTERED ${unregistered.length} path(s) — declaring is refused until the layout describes them\n`
							: "") +
						`\n  write it:   refarm node declare --out <file>\n`,
				);
				return;
			}

			if (unregistered.length > 0) {
				throw new Error(
					`refusing to declare: ${unregistered.length} path(s) are unregistered — no layout entry covers them:\n  ` +
						`${unregistered.slice(0, 10).join("\n  ")}\n` +
						`  Add entries to sovereign-layout.ts deliberately, then declare.`,
				);
			}
			if (fs.existsSync(options.out) && !options.force) {
				throw new Error(`${options.out} already exists — pass --force to overwrite it`);
			}
			const passphrase = await resolvePassphrase(channelOf(), process.env, true);
			const declaration: NodeDeclaration = buildDeclaration({
				nodeName: String((config.node as { name?: unknown } | undefined)?.name ?? "unnamed"),
				declaredAt: new Date().toISOString(),
				governance: options.governance === "repo" ? "repo" : "local",
				config,
				authPolicy,
				seal: sealPayload(
					{ files: Object.fromEntries(sealedFiles.map((file) => [file.relative, file.base64])) },
					passphrase,
				),
				reAuthenticate: silo.reAuthenticate,
				notCarried,
			});
			fs.writeFileSync(options.out, `${JSON.stringify(declaration, null, 2)}\n`);
			const result = {
				out: options.out,
				bytes: fs.statSync(options.out).size,
				sealed: sealedFiles.length,
				reAuthenticate: silo.reAuthenticate,
			};
			if (options.json) {
				printJson(buildJsonSuccessEnvelope({ command: "node", operation: "declare", extra: result }));
			} else {
				process.stdout.write(
					`declared ${options.out} — ${result.bytes} bytes, ${result.sealed} identity file(s) sealed\n` +
						`  The passphrase is the ONLY thing that opens this file. Nothing else can.\n` +
						`  re-authenticate after applying: ${silo.reAuthenticate.join(", ") || "(none)"}\n`,
				);
			}
		});

	return node;
}

export const nodeCommand = createNodeCommand();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Register the command**

In `apps/refarm/src/program.ts`, add beside the existing `backup` import (line 6):

```ts
import { nodeCommand } from "./commands/node.js";
```

and beside `program.addCommand(backupCommand);` (line 286):

```ts
program.addCommand(nodeCommand);
```

- [ ] **Step 6: Add the probe entry**

In `scripts/directory-independence.mjs`, add to `PROBE_COMMANDS` beside the `backup plan` entry:

```js
	{
		name: "node declare",
		argv: ["node", "declare", "--json"],
		scope: "node",
		scopeReason:
			"What a node declares about itself is a fact about its home, never about the shell that asked. A cwd-dependent preview would let an operator seal a declaration describing a different node than the one he is standing up, and the error would only surface on the machine where nothing else is left to check it against.",
	},
```

- [ ] **Step 7: Run the gates**

```bash
pnpm -C apps/refarm exec vitest run test/commands/probe-coverage.test.ts test/program.test.ts
node scripts/directory-independence.mjs
pnpm --filter @refarm.dev/refarm run build
node apps/refarm/dist/index.js node declare
```
Expected: probe-coverage PASS, `node declare` measures `same`, and the built CLI prints the preview against the real node without asking for anything.

- [ ] **Step 8: Commit**

```bash
node apps/refarm/dist/index.js agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/node.ts apps/refarm/src/commands/node.test.ts apps/refarm/src/program.ts scripts/directory-independence.mjs
git commit -m "feat(node): declare a node as one file, previewable before it is sealed"
```

---

## Task 4: `refarm node diff`

**Files:**
- Modify: `apps/refarm/src/commands/node.ts`
- Test: `apps/refarm/src/commands/node.test.ts`

**Interfaces:**
- Consumes: `diffDeclarations` (Task 2), `readSealState` (Task 1).
- Produces: the `diff` subcommand. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `apps/refarm/src/commands/node.test.ts`:

```ts
describe("node diff", () => {
	async function declaredFile(home: string): Promise<string> {
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel(["pw", "pw"]));
		await command.parseAsync(["declare", "--out", target, "--json"], { from: "user" });
		return target;
	}

	it("reports aligned when nothing changed since the declaration", async () => {
		const home = syntheticHome();
		const file = await declaredFile(home);
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel([]));
		await command.parseAsync(["diff", file, "--json"], { from: "user" });
		expect(process.exitCode ?? 0).toBe(0);
	});

	it("reports divergence after the node's config changes, and EXITS NON-ZERO", async () => {
		// A diff that exits 0 on divergence cannot be a gate, and Slice 2 wires exactly this into
		// `agent finish` so a declaration cannot go stale in silence.
		const home = syntheticHome();
		const file = await declaredFile(home);
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ node: { name: "n1" }, surfaces: { web: { port: 4000 } } }),
		);
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel([]));
		await command.parseAsync(["diff", file, "--json"], { from: "user" });
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});

	it("says UNCOMPARABLE rather than aligned when the seal is a custody it cannot open", async () => {
		const home = syntheticHome();
		const file = await declaredFile(home);
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		fs.writeFileSync(file, JSON.stringify({ ...parsed, seal: { ...parsed.seal, custody: "peer" } }));
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel([]));
		await command.parseAsync(["diff", file, "--json"], { from: "user" });
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node.test.ts -t "node diff"`
Expected: FAIL — `error: unknown command 'diff'`.

- [ ] **Step 3: Write the implementation**

Add to `createNodeCommand` in `apps/refarm/src/commands/node.ts`, before `return node;`:

```ts
	node
		.command("diff")
		.argument("<file>", "A declaration written by `refarm node declare --out`")
		.description("Compare this node against a declaration, key by key")
		.option("--json", "Output machine-readable result")
		.action((file: string, options: { json?: boolean }) => {
			const home = homeOf();
			const declaration = readJsonFile(file) as NodeDeclaration | null;
			if (!declaration) throw new Error(`${file} is not a readable declaration`);
			const config = readJsonFile(path.join(home, ".refarm", "config.json")) ?? {};
			const diff = diffDeclarations(config, declaration);
			const seal = readSealState(declaration.seal);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "node",
						operation: "diff",
						extra: { file, diff, seal, governance: declaration.governance },
					}),
				);
			} else {
				const label: Record<string, string> = {
					aligned: "=",
					"node-only": "> only on this node",
					"source-only": "< only in the file",
					divergent: "! different",
				};
				process.stdout.write(
					`${file} (governance: ${declaration.governance})\n` +
						diff.keys
							.map((entry) => `  ${entry.key.padEnd(20)} ${label[entry.verdict]}\n`)
							.join("") +
						`  identity             ${diff.identity}` +
						(seal.state === "openable" ? "\n" : ` — ${(seal as { reason: string }).reason}\n`),
				);
			}
			// NON-ZERO ON DIVERGENCE, so this can be a gate rather than a report.
			if (!diff.aligned) process.exitCode = 1;
		});
```

Add `diffDeclarations` and `readSealState` to the existing imports at the top of the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/refarm run type-check
node apps/refarm/dist/index.js agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/node.ts apps/refarm/src/commands/node.test.ts
git commit -m "feat(node): diff a node against its declaration, directional and three-stated"
```

---

## Task 5: `refarm node apply`

**Files:**
- Modify: `apps/refarm/src/commands/node.ts`
- Modify: `apps/refarm/src/commands/backup.ts` (one line in `plan`'s human output)
- Modify: `scripts/directory-independence-exclusions.mjs`
- Test: `apps/refarm/src/commands/node.test.ts`

**Interfaces:**
- Consumes: `unsealPayload`, `SealRefusalError` (Task 1); `diffDeclarations` (Task 2).
- Produces: the `apply` subcommand. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `apps/refarm/src/commands/node.test.ts`:

```ts
describe("node apply", () => {
	async function declaredFile(home: string): Promise<string> {
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(() => home, () => createScriptedOperatorChannel(["pw", "pw"]));
		await command.parseAsync(["declare", "--out", target, "--json"], { from: "user" });
		return target;
	}

	it("restores decisions AND identity onto an empty home", async () => {
		const source = syntheticHome();
		const file = await declaredFile(source);
		const fresh = syntheticHome();
		fs.rmSync(path.join(fresh, ".refarm"), { recursive: true, force: true });
		const command = createNodeCommand(() => fresh, () => createScriptedOperatorChannel(["pw"]));
		await command.parseAsync(["apply", file, "--yes", "--json"], { from: "user" });
		expect(JSON.parse(fs.readFileSync(path.join(fresh, ".refarm", "config.json"), "utf8"))).toMatchObject({
			surfaces: { web: { port: 3000 } },
		});
		expect(fs.readFileSync(path.join(fresh, ".refarm", "tls", "ca.key"), "utf8")).toBe("PRIVATE-CA-KEY");
	});

	it("refuses a wrong passphrase and leaves the target UNTOUCHED", async () => {
		const source = syntheticHome();
		const file = await declaredFile(source);
		const fresh = syntheticHome();
		fs.rmSync(path.join(fresh, ".refarm"), { recursive: true, force: true });
		const command = createNodeCommand(() => fresh, () => createScriptedOperatorChannel(["wrong"]));
		await expect(
			command.parseAsync(["apply", file, "--yes", "--json"], { from: "user" }),
		).rejects.toThrow(/passphrase/iu);
		expect(fs.existsSync(path.join(fresh, ".refarm", "config.json"))).toBe(false);
	});

	it("does not write without --yes or a confirmation", async () => {
		// CLAUDE.md section 8: no silent high-impact action. `apply` overwrites the operator's live
		// declarations, which is exactly the class that must be confirmed.
		const source = syntheticHome();
		const file = await declaredFile(source);
		const fresh = syntheticHome();
		fs.rmSync(path.join(fresh, ".refarm"), { recursive: true, force: true });
		// ONE answer in the queue, and it is the confirmation. The passphrase is never asked for
		// because the refusal happens first — if that order ever inverts, this test fails with
		// "answer queue exhausted" instead of passing while the operator types a secret for an
		// operation he already declined.
		const command = createNodeCommand(() => fresh, () => createScriptedOperatorChannel([false]));
		await command.parseAsync(["apply", file, "--json"], { from: "user" });
		expect(fs.existsSync(path.join(fresh, ".refarm", "config.json"))).toBe(false);
	});

	it("names replication as NOT DONE when no peer answered, and points at the escape hatch", async () => {
		// The operator has one node. "Data replicates through the mesh" is true of the design and
		// false of his machine today, and a command that stayed quiet about it would be claiming a
		// completeness that does not exist.
		const source = syntheticHome();
		const file = await declaredFile(source);
		const fresh = syntheticHome();
		fs.rmSync(path.join(fresh, ".refarm"), { recursive: true, force: true });
		const out: string[] = [];
		const write = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string) => { out.push(String(chunk)); return true; }) as never;
		try {
			const command = createNodeCommand(() => fresh, () => createScriptedOperatorChannel(["pw"]));
			await command.parseAsync(["apply", file, "--yes"], { from: "user" });
		} finally {
			process.stdout.write = write;
		}
		const printed = out.join("");
		expect(printed).toMatch(/não replicad|not replicated/iu);
		expect(printed).toContain("refarm backup create");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node.test.ts -t "node apply"`
Expected: FAIL — `error: unknown command 'apply'`.

- [ ] **Step 3: Write the implementation**

Add to `createNodeCommand` in `apps/refarm/src/commands/node.ts`, before `return node;`:

```ts
	node
		.command("apply")
		.argument("<file>", "A declaration written by `refarm node declare --out`")
		.description("Write a declaration's decisions and identity onto this node")
		.option("--json", "Output machine-readable result")
		.option("--yes", "Skip the confirmation — for automation, never for a first run")
		.action(async (file: string, options: { json?: boolean; yes?: boolean }) => {
			const home = homeOf();
			const declaration = readJsonFile(file) as NodeDeclaration | null;
			if (!declaration) throw new Error(`${file} is not a readable declaration`);
			const seal = readSealState(declaration.seal);
			if (seal.state !== "openable") {
				throw new Error(`cannot apply ${file}: ${(seal as { reason: string }).reason}`);
			}

			const channel = channelOf();
			// THE DIFF IS SHOWN BEFORE THE PASSPHRASE IS ASKED FOR. An operator who sees the change is
			// wrong should not have had to type a secret to learn it.
			const current = readJsonFile(path.join(home, ".refarm", "config.json")) ?? {};
			const diff = diffDeclarations(current, declaration);
			if (!options.yes) {
				const changing = diff.keys.filter((entry) => entry.verdict !== "aligned");
				channel.say?.(
					`Applying ${file} will change ${changing.length} key(s): ` +
						`${changing.map((entry) => entry.key).join(", ") || "(none)"}`,
				);
				const confirmed = await channel.ask({
					type: "confirm",
					question: "Write these declarations and this identity onto this node?",
				});
				if (!confirmed) {
					process.stdout.write("nothing written\n");
					return;
				}
			}

			const passphrase = await resolvePassphrase(channel, process.env, false);
			// UNSEALED BEFORE ANYTHING IS WRITTEN. A wrong passphrase must leave the node exactly as it
			// was, not half-applied.
			const opened = unsealPayload(declaration.seal, passphrase) as {
				files?: Record<string, string>;
			};

			fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
			fs.writeFileSync(
				path.join(home, ".refarm", "config.json"),
				`${JSON.stringify(declaration.declarations, null, 2)}\n`,
			);
			if (declaration.authPolicy) {
				fs.writeFileSync(
					path.join(home, ".refarm", "auth-policy.json"),
					`${JSON.stringify(declaration.authPolicy, null, 2)}\n`,
				);
			}
			const written: string[] = [];
			for (const [relative, base64] of Object.entries(opened.files ?? {})) {
				const target = path.join(home, relative);
				fs.mkdirSync(path.dirname(target), { recursive: true });
				fs.writeFileSync(target, Buffer.from(base64, "base64"));
				written.push(relative);
			}

			// THREE STATES, and today the operator's answer is the middle one. Replication is not
			// attempted by this slice, so it reports `not-attempted` rather than inventing a peer count.
			const replication = { state: "not-attempted" as const, peers: 0 };
			const result = {
				file,
				keys: declaration.declarations ? Object.keys(declaration.declarations).length : 0,
				identityFiles: written.length,
				reAuthenticate: declaration.reAuthenticate,
				replication,
			};
			if (options.json) {
				printJson(buildJsonSuccessEnvelope({ command: "node", operation: "apply", extra: result }));
			} else {
				process.stdout.write(
					`applied ${file}\n` +
						`  ✓ ${result.keys} declaration key(s), ${written.length} identity file(s)\n` +
						`  → data: not replicated — this slice does not sync, and a node with no peer has\n` +
						`    nobody to sync from. History and storage did NOT come back.\n` +
						`    until a second node exists:  refarm backup create <destination>\n` +
						`  re-authenticate: ${declaration.reAuthenticate.join(", ") || "(none)"}\n`,
				);
			}
		});
```

Add `unsealPayload` to the existing imports from `./node-seal.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/refarm exec vitest run src/commands/node.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Declare `node apply` as a mutator**

In `scripts/directory-independence-exclusions.mjs`, add to `PROBE_EXCLUSIONS` beside the existing `init` entry:

```js
	{
		name: "node apply",
		category: "mutates",
		reason:
			"Writes the node's declarations and identity onto the home. Probing it would overwrite the operator's live config with a fixture, which is the one thing this command must never do by accident.",
	},
```

- [ ] **Step 6: Point `backup plan` at the other command**

In `apps/refarm/src/commands/backup.ts`, in the `plan` subcommand's human output (after the namespaces block, around line 229), append to the written string:

```ts
					"\n  This bundle is the 95% a declaration does not carry: history and storage.\n" +
					"  For the decisions and identity as ONE readable file:  refarm node declare\n"
```

- [ ] **Step 7: Run every gate**

```bash
pnpm --filter @refarm.dev/refarm run type-check
pnpm -C apps/refarm exec vitest run src/commands/ test/commands/probe-coverage.test.ts
node scripts/directory-independence.mjs
pnpm --filter @refarm.dev/refarm run build
node apps/refarm/dist/index.js node declare
node apps/refarm/dist/index.js backup plan | tail -5
```
Expected: all PASS; `node declare` previews the real node; `backup plan` ends with the pointer.

- [ ] **Step 8: Commit**

```bash
node apps/refarm/dist/index.js agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/node.ts apps/refarm/src/commands/node.test.ts apps/refarm/src/commands/backup.ts scripts/directory-independence-exclusions.mjs
git commit -m "feat(node): apply a declaration, and say out loud what did not come back"
node apps/refarm/dist/index.js agent finish --lane after-commit --run --json
```

---

## What this slice deliberately does NOT build

Named so a reviewer does not read them as omissions:

- **`node promote` and `governance: "repo"` enforcement** (Slice 3). `governance` is recorded and displayed; nothing enforces it yet. D4's four verdicts exist so that this stays additive.
- **`declare --check` in the `agent finish` lanes** (Slice 2). `node diff` already exits non-zero on divergence, which is the whole mechanism the lane needs.
- **Successor custodies** (Slice 4). `KNOWN_CUSTODIES` has one entry and `readSealState` already answers correctly for the others.
- **Actual replication.** `apply` reports `not-attempted`; wiring `sync-loro` needs a second node to prove anything, and a peerless implementation would only be able to report the same result more expensively.
