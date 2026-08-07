import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildParityReport,
	normalizeIsolatingOverrides,
	PARITY_AXES,
	readTractorEngineMode,
	resolveModelRouteFromTokens,
	type NodeParitySnapshot,
	type ParityInput,
} from "./parity.js";

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

// ---------------------------------------------------------------------------------------
// Regression coverage for the two Criticals a review found: both were shared-input bugs at
// the SEAM between the impure edge and the pure core, and the original 20 tests above never
// exercised that seam — they drove `buildParityReport` directly with literal snapshots.
// `readTractorEngineMode` and `resolveModelRouteFromTokens` are exported specifically so a
// test CAN drive that seam with literals (an injected `readFile`, a stubbed `process.env`)
// without needing a live filesystem, a live daemon, or two live nodes.
// ---------------------------------------------------------------------------------------

describe("readTractorEngineMode — Critical 1 regression: no shared cwd-local config layer", () => {
	it("reads ONLY <refarmHome>/config.json — two DIFFERENT homes with different content give DIFFERENT results", () => {
		const files = new Map<string, string>([
			["/home/op/.refarm/config.json", JSON.stringify({ tractor: { engine: "rust" } })],
			["/repo/.sandbox/refarm/config.json", JSON.stringify({ tractor: { engine: "ts" } })],
		]);
		const readFile = (p: string) => {
			const content = files.get(p);
			if (content === undefined) throw new Error(`ENOENT: ${p}`);
			return content;
		};
		expect(readTractorEngineMode("/home/op/.refarm", readFile)).toBe("rust");
		expect(readTractorEngineMode("/repo/.sandbox/refarm", readFile)).toBe("ts");
	});

	it("THE ORIGINAL BUG, reproduced directly: a config file that exists at a THIRD, shared path never leaks in — this function takes no cwd at all", () => {
		// The critical bug merged `<cwd>/.refarm/config.json` — the SAME file for both nodes
		// — as a second, higher-priority layer. This function has no `cwd` parameter, so
		// there is no second layer to share in the first place; asserting the plain
		// single-path read below is what makes that structurally true, not incidental.
		const files = new Map<string, string>([
			["/home/op/.refarm/config.json", JSON.stringify({ tractor: { engine: "rust" } })],
			// A stray repo-local config a real checkout happens to have (this repo's own
			// <repo>/.refarm/config.json, in life) — must never be consulted for either node.
			["/repo/.refarm/config.json", JSON.stringify({ tractor: { engine: "auto" } })],
		]);
		const readFile = (p: string) => {
			const content = files.get(p);
			if (content === undefined) throw new Error(`ENOENT: ${p}`);
			return content;
		};
		// The sandbox's OWN home has no config.json at all — must default to "auto" from
		// ITS OWN absence, never silently pick up the operator's "rust" or the stray repo
		// file's "auto" (which would coincidentally look right here but for the wrong reason).
		expect(readTractorEngineMode("/repo/.sandbox/refarm", readFile)).toBe("auto");
		expect(readTractorEngineMode("/home/op/.refarm", readFile)).toBe("rust");
	});

	it("an absent config.json defaults to \"auto\", matching resolveTractorEngineMode's own documented default", () => {
		const readFile = (p: string) => {
			throw new Error(`ENOENT: ${p}`);
		};
		expect(readTractorEngineMode("/repo/.sandbox/refarm", readFile)).toBe("auto");
	});

	it("malformed JSON also defaults to \"auto\" rather than throwing — matches readConfig's own established precedent", () => {
		const readFile = () => "{ not json";
		expect(readTractorEngineMode("/anywhere", readFile)).toBe("auto");
	});

	it("an unrecognized engine value in the file also defaults to \"auto\", never an invented third value", () => {
		const readFile = () => JSON.stringify({ tractor: { engine: "quantum" } });
		expect(readTractorEngineMode("/anywhere", readFile)).toBe("auto");
	});
});

describe("resolveModelRouteFromTokens — Critical 2 regression: no environment consulted at all", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("two DIFFERENT token objects give DIFFERENT routes — this is genuinely per-node", () => {
		const operator = resolveModelRouteFromTokens({ modelProvider: "openai-codex", modelId: "gpt-5.5" });
		const sandbox = resolveModelRouteFromTokens({ modelProvider: "anthropic", modelId: "claude-sonnet-5" });
		expect(operator.ref).toBe("openai-codex/gpt-5.5");
		expect(sandbox.ref).toBe("anthropic/claude-sonnet-5");
		expect(operator.ref).not.toBe(sandbox.ref);
	});

	it("THE ORIGINAL BUG, reproduced directly: an ambient process.env override is IGNORED, never applied to either side's result", () => {
		vi.stubEnv("MODEL_PROVIDER", "anthropic");
		vi.stubEnv("MODEL_ID", "claude-sonnet-5");
		// If this function consulted process.env the way buildCurrentModelStatus's body
		// does, BOTH of the following would resolve to "anthropic/claude-sonnet-5" —
		// identical — regardless of what each side's own tokens actually say. That
		// collapse is exactly what let a real per-node divergence go invisible.
		const operator = resolveModelRouteFromTokens({ modelProvider: "openai-codex", modelId: "gpt-5.5" });
		const sandbox = resolveModelRouteFromTokens({ modelProvider: "ollama", modelId: "llama3.2" });
		expect(operator.ref).toBe("openai-codex/gpt-5.5");
		expect(sandbox.ref).toBe("ollama/llama3.2");
	});

	it("an env-set credential (OPENAI_CODEX_ACCESS_TOKEN) does not leak into credentialState either — tokens alone decide it", () => {
		vi.stubEnv("OPENAI_CODEX_ACCESS_TOKEN", "not-a-real-token-value");
		const result = resolveModelRouteFromTokens({ modelProvider: "openai-codex", modelId: "gpt-5.5" });
		// With no environment consulted, an openai-codex route with no oauth/api-key token
		// in `tokens` itself resolves to "missing", never the env-derived "env" state that
		// a real OPENAI_CODEX_ACCESS_TOKEN in this process's own env would otherwise cause.
		expect(result.credentialState).toBe("missing");
	});

	it("empty tokens still resolve to a real, deterministic route (the built-in default), never throwing", () => {
		const result = resolveModelRouteFromTokens({});
		expect(result.ref).toBeTruthy();
		expect(result.credentialState).toBeTruthy();
	});
});

describe("ParityFinding.observedVia — only plugin asks a live daemon anything (Important 3)", () => {
	it("plugin is observed via the daemon; the other three are observed via config/declared, never daemon", () => {
		const report = buildParityReport(BASE);
		expect(findingFor(report, "plugin").observedVia).toBe("daemon");
		expect(findingFor(report, "model-route").observedVia).toBe("config");
		expect(findingFor(report, "engine").observedVia).toBe("config");
		expect(findingFor(report, "namespace").observedVia).toBe("declared");
	});
});

describe("buildParityReport — the escape hatch (Important 4): --expect-divergence overrides isolating per run", () => {
	it("with no override, a model-route divergence is unhealthy (the default)", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, modelRoute: { ref: "ollama/llama3.2", credentialState: "not-required" } },
		};
		const finding = findingFor(buildParityReport(input), "model-route");
		expect(finding.isolating).toBe(false);
		expect(finding.isolatingSource).toBe("default");
		expect(finding.healthy).toBe(false);
	});

	it("declaring model-route divergent for this run makes the SAME divergence healthy, and says so via isolatingSource", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, modelRoute: { ref: "ollama/llama3.2", credentialState: "not-required" } },
		};
		const report = buildParityReport(input, { isolatingOverrides: { "model-route": true } });
		const finding = findingFor(report, "model-route");
		expect(finding.isolating).toBe(true);
		expect(finding.isolatingSource).toBe("override");
		expect(finding.verdict).toBe("different");
		expect(finding.healthy).toBe(true);
		expect(report.healthy).toBe(true);
	});

	it("an override for one axis never touches the others' isolatingSource", () => {
		const report = buildParityReport(BASE, { isolatingOverrides: { "model-route": true } });
		expect(findingFor(report, "model-route").isolatingSource).toBe("override");
		expect(findingFor(report, "plugin").isolatingSource).toBe("default");
		expect(findingFor(report, "engine").isolatingSource).toBe("default");
		expect(findingFor(report, "namespace").isolatingSource).toBe("default");
	});

	it("namespace keeps its default isolating:true when no override names it", () => {
		const finding = findingFor(buildParityReport(BASE, { isolatingOverrides: { "model-route": true } }), "namespace");
		expect(finding.isolating).toBe(true);
		expect(finding.isolatingSource).toBe("default");
	});
});

describe("normalizeIsolatingOverrides — pure validation for --expect-divergence (Important 4)", () => {
	it("accepts every real axis name and turns it into an override", () => {
		const { overrides, invalid } = normalizeIsolatingOverrides(["model-route", "engine"]);
		expect(overrides).toEqual({ "model-route": true, engine: true });
		expect(invalid).toEqual([]);
	});

	it("rejects an unknown axis name, naming it, without silently dropping it", () => {
		const { overrides, invalid } = normalizeIsolatingOverrides(["model-route", "not-a-real-axis"]);
		expect(overrides).toEqual({ "model-route": true });
		expect(invalid).toEqual(["not-a-real-axis"]);
	});

	it("empty input yields no overrides and no invalid names", () => {
		expect(normalizeIsolatingOverrides([])).toEqual({ overrides: {}, invalid: [] });
	});
});

describe("checkPlugin wording (Minor 6): 'different' is never described as 'disagree' when both sides AGREE it is not loaded", () => {
	it("neither node loaded — summary says so plainly, never 'disagree'", () => {
		const input: ParityInput = {
			operator: { ...OPERATOR, plugin: { reachable: true, loaded: false, hash: null } },
			sandbox: { ...SANDBOX, plugin: { reachable: true, loaded: false, hash: null } },
		};
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.verdict).toBe("different");
		expect(finding.healthy).toBe(false);
		expect(finding.summary.toLowerCase()).not.toContain("disagree");
		expect(finding.summary.toLowerCase()).toContain("neither node has the agent plugin loaded");
	});

	it("exactly one side loaded — summary DOES say the daemons disagree, correctly", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, plugin: { reachable: true, loaded: false, hash: null } },
		};
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.verdict).toBe("different");
		expect(finding.summary.toLowerCase()).toContain("disagree");
	});
});
