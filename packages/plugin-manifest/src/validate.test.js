import { describe, expect, it } from "vitest";
import { createMockManifest } from "./fixtures";
import { validatePluginManifest } from "./validate";

describe("plugin-manifest validation", () => {
	it("accepts valid manifest with required observability hooks", () => {
		const result = validatePluginManifest(
			createMockManifest({
				id: "@acme/storage-opfs",
				name: "ACME Storage",
			}),
		);

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects manifest missing required observability hooks", () => {
		const manifest = createMockManifest();
		manifest.observability.hooks = ["onLoad"]; // Missing others

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors.some((error) => error.includes("onRequest"))).toBe(
			true,
		);
	});
});

describe("permission vocabulary (effect axis)", () => {
	it("accepts a manifest declaring only known permissions", () => {
		const manifest = createMockManifest({
			permissions: ["fs:read", "fs:write", "shell:spawn", "network:outbound"],
		});
		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects a permission outside the closed vocabulary", () => {
		const manifest = createMockManifest({
			permissions: ["fs:read", "fs:reed"],
		});
		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) =>
					e.includes("unknown capabilities") && e.includes("fs:reed"),
			),
		).toBe(true);
	});

	it("does not confuse the requires-axis (storage:v1) for a permission", () => {
		// storage:v1 is a capabilities.requires value, NOT an effect permission.
		const manifest = createMockManifest({ permissions: ["storage:v1"] });
		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) => e.includes("storage:v1")),
		).toBe(true);
	});
});

describe("composition validation", () => {
	it("accepts a manifest with valid API definitions", () => {
		const manifest = createMockManifest({
			capabilities: {
				provides: ["test"],
				requires: [],
				providesApi: ["StorageApi"],
				requiresApi: ["AuthApi"],
			},
		});
		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
	});

	it("rejects duplicates in APIs", () => {
		const manifest = createMockManifest();
		manifest.capabilities.providesApi = ["Api1", "Api1"];

		const result = validatePluginManifest(manifest);
		expect(result.errors).toContain(
			"capabilities.providesApi must not contain duplicates",
		);
	});
});

describe("certification validation", () => {
	it("accepts a manifest with valid certification", () => {
		const manifest = createMockManifest({
			certification: {
				license: "MIT",
				a11yLevel: 2,
				languages: ["en", "pt"],
			},
		});
		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
	});

	it("rejects invalid accessibility levels", () => {
		const manifest = createMockManifest();

		// Level < 0
		let result = validatePluginManifest({
			...manifest,
			certification: { ...manifest.certification, a11yLevel: -1 },
		});
		expect(result.errors).toContain(
			"certification.a11yLevel must be a number between 0 and 3",
		);

		// Level > 3
		result = validatePluginManifest({
			...manifest,
			certification: { ...manifest.certification, a11yLevel: 4 },
		});
		expect(result.errors).toContain(
			"certification.a11yLevel must be a number between 0 and 3",
		);
	});

	it("rejects empty certification fields", () => {
		const manifest = createMockManifest();

		// Empty license
		let result = validatePluginManifest({
			...manifest,
			certification: { ...manifest.certification, license: "" },
		});
		expect(result.errors).toContain("certification.license is required");

		// Empty languages
		result = validatePluginManifest({
			...manifest,
			certification: { ...manifest.certification, languages: [] },
		});
		expect(result.errors).toContain(
			"certification.languages must be a non-empty array",
		);
	});
});

describe("trust profile validation", () => {
	it("accepts trusted-fast profile with a valid lease", () => {
		const manifest = createMockManifest({
			trust: {
				profile: "trusted-fast",
				leaseHours: 24,
			},
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
	});

	it("rejects invalid trust profile and lease", () => {
		const manifest = createMockManifest({
			trust: {
				profile: "trusted-fast",
				leaseHours: 0,
			},
		});

		manifest.trust.profile = "unsafe";

		const result = validatePluginManifest(manifest);
		expect(result.errors).toContain(
			"trust.profile must be one of: strict, trusted-fast",
		);
		expect(result.errors).toContain(
			"trust.leaseHours must be a positive number when provided",
		);
	});
});

describe("extension surface validation", () => {
	it("accepts a manifest with declared multi-surface extensions", () => {
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "stream-renderer",
						slot: "session-view",
						capabilities: ["ui:stream:read"],
					},
					{
						layer: "asset",
						kind: "theme-pack",
						id: "stream-themes",
						assets: ["./themes/default.json"],
					},
				],
			},
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects malformed extension surfaces", () => {
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "unknown",
						kind: "",
						id: "",
						slot: "",
						capabilities: ["ui:stream:read", ""],
						assets: ["./asset.json", ""],
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "stream-renderer",
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "stream-renderer",
					},
				],
			},
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"extensions.surfaces[0].layer must be one of: tractor, homestead, pi, automation, desktop, asset",
		);
		expect(result.errors).toContain(
			"extensions.surfaces[0].kind must be a non-empty string",
		);
		expect(result.errors).toContain(
			"extensions.surfaces[0].id must be a non-empty string",
		);
		expect(result.errors).toContain(
			"extensions.surfaces[0].slot must be a non-empty string when provided",
		);
		expect(result.errors).toContain(
			"extensions.surfaces[0].capabilities must be an array of non-empty strings when provided",
		);
		expect(result.errors).toContain(
			"extensions.surfaces[0].assets must be an array of non-empty strings when provided",
		);
		expect(result.errors).toContain(
			"extensions.surfaces must not contain duplicate layer/id pairs",
		);
	});

	it("accepts pi skill surfaces with declared capabilities and a package SKILL.md asset", () => {
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "pi",
						kind: "skill",
						id: "refarm-git-workflow",
						assets: ["skills/refarm-git-workflow/SKILL.md"],
						capabilities: ["refarm.operator-loop", "refarm.git.write"],
					},
				],
			},
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects pi skill surfaces that are not package skill declarations", () => {
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "pi",
						kind: "skill",
						id: "refarm-git-workflow",
						slot: "main",
						assets: ["file:skills/refarm-git-workflow/SKILL.md"],
						capabilities: [],
					},
					{
						layer: "pi",
						kind: "skill",
						id: "refarm-vault-daily",
						assets: ["/tmp/SKILL.md", "skills/refarm-vault-daily/README.md"],
					},
				],
			},
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		// Still rejected for the genuinely skill-shaped violations: a `slot` on a
		// pi skill surface and a non-package SKILL.md asset.
		expect(result.errors).toContain(
			"extensions.surfaces[0].slot must not be provided for pi skill surfaces",
		);
		expect(result.errors).toContain(
			"extensions.surfaces[0].assets must include a relative SKILL.md asset for pi skill surfaces",
		);
		expect(result.errors).toContain(
			"extensions.surfaces[1].assets must include a relative SKILL.md asset for pi skill surfaces",
		);
		// NOT rejected for empty/missing capabilities — permissive maturity is a
		// generic, surface-agnostic concern, not a pi-skill gate.
		expect(result.errors).not.toContain(
			"extensions.surfaces[0].capabilities must be a non-empty array for pi skill surfaces",
		);
		expect(result.errors).not.toContain(
			"extensions.surfaces[1].capabilities must be a non-empty array for pi skill surfaces",
		);
	});

	it("accepts a permissive pi skill surface with no declared capabilities", () => {
		// A skill with only name/description (its capabilities live in the SKILL.md
		// body at authoring time) is a valid *permissive* surface — the same rule
		// every other surface follows. It must not be rejected upstream of the
		// skill contract, which already accepts zero capabilities.
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "pi",
						kind: "skill",
						id: "refarm-vault-daily",
						assets: ["skills/refarm-vault-daily/SKILL.md"],
					},
				],
			},
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});
});

describe("contract baseline validation", () => {
	it("rejects absolute entry paths", () => {
		const manifest = createMockManifest({ entry: "/dist/plugin.js" });
		const result = validatePluginManifest(manifest);

		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"entry must not be an absolute filesystem path",
		);
	});

	it("rejects invalid execution targets", () => {
		const manifest = createMockManifest({
			targets: ["browser", "edge"],
		});
		const result = validatePluginManifest(manifest);

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("invalid execution target: edge");
	});

	it("requires integrity for wasm entries", () => {
		const manifest = createMockManifest();
		delete manifest.integrity;

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("integrity is required for .wasm entries");
	});

	it("rejects malformed integrity values", () => {
		const manifest = createMockManifest({
			integrity: "sha256-not-a-valid-digest",
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"integrity must use sha256- prefix with 64 hex chars or base64 digest",
		);
	});

	it("allows .js entries without integrity", () => {
		const manifest = createMockManifest({
			entry: "./plugin.js",
			integrity: undefined,
		});

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
	});

	it("allows .mjs and .cjs entries without integrity", () => {
		const mjsManifest = createMockManifest({
			entry: "./plugin.mjs",
			integrity: undefined,
		});
		const cjsManifest = createMockManifest({
			entry: "./plugin.cjs",
			integrity: undefined,
		});

		expect(validatePluginManifest(mjsManifest).valid).toBe(true);
		expect(validatePluginManifest(cjsManifest).valid).toBe(true);
	});

	it("supports entry format detection with query/hash suffixes", () => {
		const mjsWithQuery = createMockManifest({
			entry: "https://cdn.example/plugin.mjs?build=42#module",
			integrity: undefined,
		});
		const wasmWithQueryNoIntegrity = createMockManifest({
			entry: "https://cdn.example/plugin.wasm?build=42",
			integrity: undefined,
		});

		expect(validatePluginManifest(mjsWithQuery).valid).toBe(true);

		const wasmResult = validatePluginManifest(wasmWithQueryNoIntegrity);
		expect(wasmResult.valid).toBe(false);
		expect(wasmResult.errors).toContain("integrity is required for .wasm entries");
	});

	it("accepts syncVerbs that are all in provides (per-verb sync mode)", () => {
		const manifest = createMockManifest({
			capabilities: {
				provides: ["source:v1", "source:discover", "source:status"],
				requires: [],
				syncVerbs: ["source:discover", "source:status"],
			},
		});
		expect(validatePluginManifest(manifest).valid).toBe(true);
	});

	it("rejects a syncVerb that is not in provides (can't be sync for a verb you don't offer)", () => {
		const manifest = createMockManifest({
			capabilities: {
				provides: ["source:v1", "source:discover"],
				requires: [],
				syncVerbs: ["source:materialize"],
			},
		});
		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			'capabilities.syncVerbs entry "source:materialize" is not in capabilities.provides',
		);
	});

	it("rejects duplicate syncVerbs", () => {
		const manifest = createMockManifest({
			capabilities: {
				provides: ["source:v1", "source:discover"],
				requires: [],
				syncVerbs: ["source:discover", "source:discover"],
			},
		});
		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("capabilities.syncVerbs must not contain duplicates");
	});

	it("treats absent syncVerbs as async-default (optional, permissive)", () => {
		const manifest = createMockManifest();
		expect(manifest.capabilities.syncVerbs).toBeUndefined();
		expect(validatePluginManifest(manifest).valid).toBe(true);
	});
});
