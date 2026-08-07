import { describe, expect, it } from "vitest";
import { buildParityReport, PARITY_AXES, type NodeParitySnapshot, type ParityInput } from "./parity.js";

// Everything a real `refarm parity` run would see when the sandbox is healthy and
// isolated correctly: the three MIRRORED axes (model route, plugin, engine) agree,
// and the one ISOLATING axis (namespace) disagrees — which is the whole point of the
// sandbox existing. Individual tests override one field at a time via spread, mirroring
// context.test.ts's own fixture style.
const OPERATOR: NodeParitySnapshot = {
	label: "operator",
	namespace: "default",
	engine: "auto",
	modelRoute: { ref: "openai-codex/gpt-5.5", credentialState: "silo-oauth" },
	plugin: { reachable: true, loaded: true, hash: "6d78b1c152ecba006f53bf2a07fa4544faef98f23144f8153a0baa8235ae3eca" },
};

const SANDBOX: NodeParitySnapshot = {
	label: "sandbox",
	namespace: "sandbox",
	engine: "auto",
	modelRoute: { ref: "openai-codex/gpt-5.5", credentialState: "silo-oauth" },
	plugin: { reachable: true, loaded: true, hash: "6d78b1c152ecba006f53bf2a07fa4544faef98f23144f8153a0baa8235ae3eca" },
};

const BASE: ParityInput = { operator: OPERATOR, sandbox: SANDBOX };

function findingFor(report: ReturnType<typeof buildParityReport>, axis: string) {
	const finding = report.findings.find((f) => f.axis === axis);
	if (!finding) throw new Error(`no finding for axis ${axis}`);
	return finding;
}

describe("buildParityReport — the four declared axes, always, never more never fewer", () => {
	it("checks exactly the axes the brief named: model-route, plugin, engine, namespace", () => {
		const report = buildParityReport(BASE);
		expect(report.findings.map((f) => f.axis).sort()).toEqual(
			["engine", "model-route", "namespace", "plugin"].sort(),
		);
		expect(PARITY_AXES).toHaveLength(4);
	});

	it("the healthy baseline: three mirrored axes match, the one isolating axis (namespace) disagrees — report is healthy", () => {
		const report = buildParityReport(BASE);
		expect(report.healthy).toBe(true);
		expect(findingFor(report, "model-route").verdict).toBe("same");
		expect(findingFor(report, "plugin").verdict).toBe("same");
		expect(findingFor(report, "engine").verdict).toBe("same");
		expect(findingFor(report, "namespace").verdict).toBe("different");
	});
});

describe("buildParityReport — declared vs undeclared divergence", () => {
	it("namespace differing is DECLARED — isolating:true, healthy:true even though the verdict is 'different'", () => {
		const finding = findingFor(buildParityReport(BASE), "namespace");
		expect(finding.isolating).toBe(true);
		expect(finding.verdict).toBe("different");
		expect(finding.healthy).toBe(true);
	});

	it("namespace MATCHING between the two nodes is UNHEALTHY, not fine — the sandbox failed to isolate its graph", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, namespace: "default" } };
		const report = buildParityReport(input);
		const finding = findingFor(report, "namespace");
		expect(finding.verdict).toBe("same");
		expect(finding.isolating).toBe(true);
		expect(finding.healthy).toBe(false);
		expect(report.healthy).toBe(false);
	});

	it("a model-route divergence is UNDECLARED — isolating:false, unhealthy, the whole report goes unhealthy", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, modelRoute: { ref: "ollama/llama3.2", credentialState: "not-required" } },
		};
		const report = buildParityReport(input);
		const finding = findingFor(report, "model-route");
		expect(finding.isolating).toBe(false);
		expect(finding.verdict).toBe("different");
		expect(finding.healthy).toBe(false);
		expect(report.healthy).toBe(false);
	});

	it("the same route ref but a different CREDENTIAL STATE still counts as a model-route divergence", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, modelRoute: { ref: "openai-codex/gpt-5.5", credentialState: "missing" } },
		};
		const finding = findingFor(buildParityReport(input), "model-route");
		expect(finding.verdict).toBe("different");
		expect(finding.healthy).toBe(false);
	});

	it("never prints a credential VALUE — only the credential state travels through model-route's operator/sandbox fields", () => {
		const finding = findingFor(buildParityReport(BASE), "model-route");
		expect(finding.operator).not.toMatch(/sk-|Bearer|ey[A-Za-z0-9]{10,}/);
		expect(finding.sandbox).toContain("silo-oauth");
	});

	it("an engine divergence is UNDECLARED — engine is not one of the four isolating axes", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, engine: "ts" } };
		const report = buildParityReport(input);
		const finding = findingFor(report, "engine");
		expect(finding.isolating).toBe(false);
		expect(finding.verdict).toBe("different");
		expect(finding.healthy).toBe(false);
		expect(report.healthy).toBe(false);
	});
});

describe("buildParityReport — plugin axis: the two failure shapes this task exists to catch", () => {
	it("failure shape 1 — a plugin file present but NOT LOADED is an undeclared divergence, never silent parity", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, plugin: { reachable: true, loaded: false, hash: null } },
		};
		const report = buildParityReport(input);
		const finding = findingFor(report, "plugin");
		expect(finding.verdict).toBe("different");
		expect(finding.isolating).toBe(false);
		expect(finding.healthy).toBe(false);
		expect(finding.summary.toLowerCase()).toContain("does not have it loaded");
	});

	it("failure shape 2 — a stopped node's sidecar is UNREADABLE, never read as a match and never as a mismatch", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, plugin: { reachable: false } } };
		const report = buildParityReport(input);
		const finding = findingFor(report, "plugin");
		expect(finding.verdict).toBe("unreadable");
		expect(finding.healthy).toBe(false);
		expect(report.healthy).toBe(false);
	});

	it("both sidecars unreachable is still unreadable, not a false 'same'", () => {
		const input: ParityInput = {
			operator: { ...OPERATOR, plugin: { reachable: false } },
			sandbox: { ...SANDBOX, plugin: { reachable: false } },
		};
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.verdict).toBe("unreadable");
		expect(finding.healthy).toBe(false);
	});

	it("both loaded, hashes match — same and healthy", () => {
		const finding = findingFor(buildParityReport(BASE), "plugin");
		expect(finding.verdict).toBe("same");
		expect(finding.healthy).toBe(true);
	});

	it("both loaded, hashes differ — undeclared build drift, never silently a match", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, plugin: { reachable: true, loaded: true, hash: "deadbeef".repeat(8) } },
		};
		const report = buildParityReport(input);
		const finding = findingFor(report, "plugin");
		expect(finding.verdict).toBe("different");
		expect(finding.healthy).toBe(false);
		expect(report.healthy).toBe(false);
	});

	it("both loaded, but the hash is unknown on one side — UNREADABLE, never a silent match", () => {
		const input: ParityInput = {
			...BASE,
			operator: { ...OPERATOR, plugin: { reachable: true, loaded: true, hash: null } },
		};
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.verdict).toBe("unreadable");
		expect(finding.healthy).toBe(false);
	});

	it("one side loaded, the other unreachable — unreachable wins, never reported as a loaded-state mismatch", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, plugin: { reachable: false } } };
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.verdict).toBe("unreadable");
	});
});

describe("buildParityReport — the unreadable case, three states never two", () => {
	it("namespace unreadable when the sandbox's own address could not be resolved at all", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, namespace: null } };
		const finding = findingFor(buildParityReport(input), "namespace");
		expect(finding.verdict).toBe("unreadable");
		expect(finding.healthy).toBe(false);
	});

	it("model-route unreadable when a node's credential store could not be resolved", () => {
		const input: ParityInput = { ...BASE, operator: { ...OPERATOR, modelRoute: null } };
		const finding = findingFor(buildParityReport(input), "model-route");
		expect(finding.verdict).toBe("unreadable");
		expect(finding.healthy).toBe(false);
	});

	it("engine unreadable when it could not be resolved for one side", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, engine: null } };
		const finding = findingFor(buildParityReport(input), "engine");
		expect(finding.verdict).toBe("unreadable");
		expect(finding.healthy).toBe(false);
	});

	it("one unreadable axis is enough to fail the whole report, even if every other axis is healthy", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, engine: null } };
		const report = buildParityReport(input);
		expect(report.healthy).toBe(false);
		expect(findingFor(report, "model-route").healthy).toBe(true);
		expect(findingFor(report, "plugin").healthy).toBe(true);
		expect(findingFor(report, "namespace").healthy).toBe(true);
	});

	it("unreadable is never silently collapsed into 'same' — same and unreadable are different verdicts entirely", () => {
		const input: ParityInput = { ...BASE, sandbox: { ...SANDBOX, plugin: { reachable: false } } };
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.verdict).not.toBe("same");
		expect(finding.verdict).toBe("unreadable");
	});
});
