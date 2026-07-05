import {
	computeSha256Digest,
	validatePluginManifest,
} from "@refarm.dev/plugin-manifest";
import {
	buildVaultPluginManifest,
	profileForVerb,
	type VaultProfile,
} from "@refarm.dev/vault-contract-v1";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	createReferenceVaultSurfaceComponent,
	loadVaultSurfaceComponent,
	type ReferenceVaultSurface,
} from "./index.js";

// This suite drives the REAL transpiled component, so it needs `pnpm
// build:component` (jco componentize + jco transpile) to have produced `pkg/`.
// That output is gitignored and heavier than a unit test, so — like the
// quality-checker-ref suite — this SKIPS when `pkg/` is absent instead of failing
// the repo-wide test run. CI builds the component first.
const pkgEntry = fileURLToPath(new URL("../pkg/vault_surface.js", import.meta.url));
const wasmPath = fileURLToPath(new URL("../dist/vault_surface.wasm", import.meta.url));
const componentBuilt = existsSync(pkgEntry);
const pkgDir = fileURLToPath(new URL("../pkg/", import.meta.url));

const NOTE = {
	path: "20-Projects/demanda-42.md",
	text: "---\ntitle: Demanda 42\nstate: doing\n---\n\nalpha body #project\n",
};

const PROFILE: VaultProfile = {
	name: "demo",
	rules: [
		{ id: "find-alpha", verb: "search", match: JSON.stringify({ type: "contains", value: "alpha" }) },
		{
			id: "extract-frontmatter",
			verb: "extract",
			match: JSON.stringify({ type: "frontmatter", recordType: "refarm:VaultRecord" }),
		},
		{
			id: "route-project",
			verb: "organize",
			match: JSON.stringify({ type: "prefix-route", marker: "#project", destination: "20-Projects" }),
		},
		{ id: "require-summary", verb: "profile", severity: "warn", match: JSON.stringify({ type: "requires", value: "summary:" }) },
	],
};

async function load(): Promise<ReferenceVaultSurface> {
	return loadVaultSurfaceComponent({ pkgDir, entry: "vault_surface.js" });
}

describe.skipIf(!componentBuilt)("vault-surface reference component (real WASM dispatch)", () => {
	it("search: runs run() through the WASM component and returns a hit", async () => {
		const surface = await load();
		const result = surface.run("search", NOTE, profileForVerb(PROFILE, "search"));
		expect(result.verb).toBe("search");
		expect(result.hits).toHaveLength(1);
		expect(result.hits[0]?.ruleId).toBe("find-alpha");
	});

	it("extract: emits a KnowledgeRecord (as record-json) from frontmatter", async () => {
		const surface = await load();
		const result = surface.run("extract", NOTE, profileForVerb(PROFILE, "extract"));
		expect(result.records).toHaveLength(1);
		const record = JSON.parse(result.records[0]!.json) as {
			id: string;
			"@type": string;
			fields: Record<string, unknown>;
			contentHash: string;
		};
		expect(record.id).toBe(NOTE.path);
		expect(record["@type"]).toBe("refarm:VaultRecord");
		expect(record.fields).toEqual({ title: "Demanda 42", state: "doing" });
		expect(record.contentHash).toMatch(/^fnv1a32:[a-f0-9]{8}$/);
	});

	it("organize + profile: the remaining two verbs dispatch through the component", async () => {
		const surface = await load();
		const org = surface.run("organize", NOTE, profileForVerb(PROFILE, "organize"));
		expect(org.plans).toHaveLength(1);
		expect(org.plans[0]?.destination).toBe("20-Projects");

		const prof = surface.run("profile", NOTE, profileForVerb(PROFILE, "profile"));
		expect(prof.findings).toHaveLength(1);
		expect(prof.findings[0]?.ruleId).toBe("require-summary");
	});

	it("SANDBOX: the component imports NOTHING — instantiated with an empty table", async () => {
		// The proof, stronger than deny-all stubs: the transpiled ImportObject is
		// `{}`. loadVaultSurfaceComponent passes NO capabilities at all, and run()
		// still returns. The surface cannot reach fs/network/clock because there is
		// no import to try — absence of capability IS the sandbox.
		const surface = await load();
		const result = surface.run("extract", NOTE, profileForVerb(PROFILE, "extract"));
		expect(result.records).toHaveLength(1);
	});

	it("createReferenceVaultSurfaceComponent() (the shipped loader) runs the component", async () => {
		const surface = await createReferenceVaultSurfaceComponent();
		const result = surface.run("search", NOTE, profileForVerb(PROFILE, "search"));
		expect(result.hits).toHaveLength(1);
	});

	it("determinism: two dispatches of the same input yield identical results", async () => {
		const surface = await load();
		const scoped = profileForVerb(PROFILE, "extract");
		const a = surface.run("extract", NOTE, scoped);
		const b = surface.run("extract", NOTE, scoped);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
});

describe.skipIf(!componentBuilt)("§8 install: the real .wasm hash completes the manifest", () => {
	it("stamping the component's SHA-256 makes the vault manifest VALID", async () => {
		// The foundation manifest is deliberately invalid (no integrity). Here the
		// REAL built .wasm supplies it — the exact swap the §8 install performs.
		const bytes = readFileSync(wasmPath);
		const digest = await computeSha256Digest(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		);
		const integrity = `sha256-${digest.hex}`;

		const foundation = buildVaultPluginManifest({ id: "@demo/vault-extract" });
		expect(validatePluginManifest(foundation).valid).toBe(false);

		const installed = buildVaultPluginManifest({
			id: "@demo/vault-extract",
			entry: "./pkg/vault_surface.wasm",
			integrity,
		});
		const result = validatePluginManifest(installed);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(installed.integrity).toMatch(/^sha256-[a-f0-9]{64}$/);
	});
});
