import { describe, expect, it } from "vitest";

import { MATURITY_TRAIL, assessExtensionMaturity, describeMaturity } from "./maturity-vocab.js";

describe("MATURITY_TRAIL", () => {
	it("has the four levels in ascending trust order", () => {
		expect(MATURITY_TRAIL.map((s) => s.level)).toEqual(["experiment", "productive", "sensitive", "catalog"]);
		expect(MATURITY_TRAIL.map((s) => s.rank)).toEqual([0, 1, 2, 3]);
	});
	it("describeMaturity looks up a level", () => {
		expect(describeMaturity("sensitive")?.label).toBe("Sensível");
		expect(describeMaturity("nope")).toBeUndefined();
	});
});

const sha = "a".repeat(64);
const allHooks = ["onLoad", "onInit", "onRequest", "onError", "onTeardown"];

describe("assessExtensionMaturity", () => {
	it("a bare manifest sits at experiment, needing conformance+integrity+telemetry to promote", () => {
		const a = assessExtensionMaturity({});
		expect(a.level).toBe("experiment");
		expect(a.next).toBe("productive");
		expect(a.missing.map((m) => m.id)).toEqual(
			expect.arrayContaining(["manifest-conformant", "integrity-known", "telemetry-present"]),
		);
	});

	it("promotes to productive when conformant + has integrity + load/error telemetry", () => {
		const a = assessExtensionMaturity({
			manifestConformant: true,
			integrity: "sha256-" + sha,
			telemetryHooks: ["onLoad", "onError"],
		});
		expect(a.level).toBe("productive");
		expect(a.next).toBe("sensitive");
	});

	it("promotes to sensitive with a WASM entry, strong integrity, strict caps, full telemetry", () => {
		const a = assessExtensionMaturity({
			manifestConformant: true,
			integrity: sha,
			telemetryHooks: allHooks,
			wasmEntry: true,
			capabilitiesStrict: true,
		});
		expect(a.level).toBe("sensitive");
		expect(a.next).toBe("catalog");
		expect(a.missing.map((m) => m.id)).toEqual(expect.arrayContaining(["versioned", "approval-trail", "revocable"]));
	});

	it("reaches catalog with versioning + approval trail + revocability", () => {
		const a = assessExtensionMaturity({
			manifestConformant: true,
			integrity: sha,
			telemetryHooks: allHooks,
			wasmEntry: true,
			capabilitiesStrict: true,
			version: "1.0.0",
			approvalTrail: true,
			revocable: true,
		});
		expect(a.level).toBe("catalog");
		expect(a.next).toBeNull();
		expect(a.missing).toEqual([]);
	});

	it("is cumulative — a gap at a lower level caps the level even if higher criteria hold", () => {
		// Has everything for catalog EXCEPT productive's integrity → stuck at experiment.
		const a = assessExtensionMaturity({
			manifestConformant: true,
			telemetryHooks: allHooks,
			wasmEntry: true,
			capabilitiesStrict: true,
			version: "1.0.0",
			approvalTrail: true,
			revocable: true,
			// integrity absent → productive fails → capped at experiment
		});
		expect(a.level).toBe("experiment");
	});

	it("a placeholder integrity is 'known' (productive) but not 'strong' (blocks sensitive)", () => {
		const a = assessExtensionMaturity({
			manifestConformant: true,
			integrity: "pending",
			telemetryHooks: allHooks,
			wasmEntry: true,
			capabilitiesStrict: true,
		});
		expect(a.level).toBe("productive");
		expect(a.missing.map((m) => m.id)).toContain("integrity-strong");
	});
});
