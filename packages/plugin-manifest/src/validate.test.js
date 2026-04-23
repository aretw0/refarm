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
});
