import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelTokens } from "./model.js";
import {
	buildParityReport,
	gatherNodeFacts,
	normalizeIsolatingOverrides,
	PARITY_AXES,
	readTractorEngineMode,
	resolveModelRouteFromTokens,
	safeEngine,
	safeModelRoute,
	type NodeParitySnapshot,
	type ParityInput,
	type ParityNodeAddress,
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

describe("checkPlugin remedies (Minor, second review round): hash-mismatch and loaded-mismatch now name a command", () => {
	it("neither loaded — names a concrete reinstall command", () => {
		const input: ParityInput = {
			operator: { ...OPERATOR, plugin: { reachable: true, loaded: false, hash: null } },
			sandbox: { ...SANDBOX, plugin: { reachable: true, loaded: false, hash: null } },
		};
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.summary).toContain("refarm plugin install --bundled");
		expect(finding.summary).toContain("scripts/refarm-sandbox.mjs start");
	});

	it("one side not loaded — names the remedy for the SPECIFIC lagging side, not a generic one", () => {
		const sandboxLagging = findingFor(
			buildParityReport({ ...BASE, sandbox: { ...SANDBOX, plugin: { reachable: true, loaded: false, hash: null } } }),
			"plugin",
		);
		expect(sandboxLagging.summary).toContain("scripts/refarm-sandbox.mjs start");

		const operatorLagging = findingFor(
			buildParityReport({ ...BASE, operator: { ...OPERATOR, plugin: { reachable: true, loaded: false, hash: null } } }),
			"plugin",
		);
		expect(operatorLagging.summary).toContain("refarm plugin install --bundled");
	});

	it("hash mismatch — names a rebuild-then-reinstall command", () => {
		const input: ParityInput = {
			...BASE,
			sandbox: { ...SANDBOX, plugin: { reachable: true, loaded: true, hash: "deadbeef".repeat(8) } },
		};
		const finding = findingFor(buildParityReport(input), "plugin");
		expect(finding.summary).toContain("pnpm --filter @refarm.dev/agent run build");
		expect(finding.summary).toContain("refarm plugin install --bundled");
	});
});

// ---------------------------------------------------------------------------------------
// blindTo (Important 1 + 2, second review round): the engine and model-route axes answer
// with full confidence from a source known to be PARTIAL, and the prior fix documented that
// only in JSDoc — invisible to a human reading output or a script gating on `.healthy`.
// `blindTo` makes it a value on every finding instead.
// ---------------------------------------------------------------------------------------

describe("ParityFinding.blindTo — the partial-observation gaps are DATA, not prose", () => {
	it("engine is blind to env, cwd-config and graph-config — the three layers that outrank the home file it reads", () => {
		const finding = findingFor(buildParityReport(BASE), "engine");
		expect(finding.blindTo).toEqual(["env", "cwd-config", "graph-config"]);
	});

	it("model-route is blind to env — the daemon's own live launch environment", () => {
		const finding = findingFor(buildParityReport(BASE), "model-route");
		expect(finding.blindTo).toEqual(["env"]);
	});

	it("plugin and namespace have no known blind spot — plugin asks the live daemon, namespace is declared, not layered", () => {
		const report = buildParityReport(BASE);
		expect(findingFor(report, "plugin").blindTo).toEqual([]);
		expect(findingFor(report, "namespace").blindTo).toEqual([]);
	});

	it("blindTo is present regardless of verdict — a property of the AXIS, not of one comparison's outcome", () => {
		const divergent = findingFor(
			buildParityReport({ ...BASE, sandbox: { ...SANDBOX, engine: "ts" } }),
			"engine",
		);
		expect(divergent.blindTo).toEqual(["env", "cwd-config", "graph-config"]);
	});

	it("a same verdict on a partially-observed axis says so in its own summary, not just via the blindTo field", () => {
		const finding = findingFor(buildParityReport(BASE), "engine");
		expect(finding.verdict).toBe("same");
		expect(finding.blindTo.length).toBeGreaterThan(0);
		expect(finding.summary.toLowerCase()).toContain("not proof");
	});

	it("healthy's formula is UNCHANGED by blindTo — a caller wanting full confidence must additionally check blindTo.length===0 itself", () => {
		const finding = findingFor(buildParityReport(BASE), "engine");
		expect(finding.verdict).toBe("same");
		expect(finding.healthy).toBe(true);
		expect(finding.blindTo).not.toEqual([]);
		// healthy is true DESPITE a non-empty blindTo — this file does not silently downgrade
		// a mirrored-axis match just because its source is partial; it hands the caller the
		// datum to decide with, per the review's own instruction not to invent a threshold.
	});
});

// ---------------------------------------------------------------------------------------
// Important 3 (second review round): coverage at the WIRING seam, one layer below the pure
// core — where both Criticals actually lived. `gatherNodeFacts`/`safeEngine`/`safeModelRoute`
// are exported specifically so this is provable with two literal `ParityNodeAddress`es and
// injected readers keyed by path, never a live filesystem, daemon, or two live processes.
// ---------------------------------------------------------------------------------------

const OPERATOR_ADDRESS: ParityNodeAddress = {
	label: "operator",
	refarmHome: "/home/op/.refarm",
	siloIdentityPath: "/home/op/.silo/identity.json",
	namespace: "default",
	sidecarUrl: "http://127.0.0.1:42001",
};

const SANDBOX_ADDRESS: ParityNodeAddress = {
	label: "sandbox",
	refarmHome: "/repo/.sandbox/refarm",
	siloIdentityPath: "/repo/.sandbox/silo/identity.json",
	namespace: "sandbox",
	sidecarUrl: "http://127.0.0.1:43001",
};

describe("safeEngine — the address's OWN refarmHome, never a shared path (wiring seam)", () => {
	it("two DIFFERENT addresses with an injected readFile keyed by path resolve DIFFERENT engines", () => {
		const files = new Map<string, string>([
			[path.join(OPERATOR_ADDRESS.refarmHome, "config.json"), JSON.stringify({ tractor: { engine: "rust" } })],
			[path.join(SANDBOX_ADDRESS.refarmHome, "config.json"), JSON.stringify({ tractor: { engine: "ts" } })],
		]);
		const readFile = (p: string) => {
			const content = files.get(p);
			if (content === undefined) throw new Error(`ENOENT: ${p}`);
			return content;
		};
		expect(safeEngine(OPERATOR_ADDRESS, readFile)).toBe("rust");
		expect(safeEngine(SANDBOX_ADDRESS, readFile)).toBe("ts");
	});
});

describe("safeModelRoute — the address's OWN siloIdentityPath, never a shared path (wiring seam)", () => {
	it("two DIFFERENT addresses with an injected loadTokens keyed by path resolve DIFFERENT routes", async () => {
		const tokensByPath = new Map<string, ModelTokens>([
			[OPERATOR_ADDRESS.siloIdentityPath, { modelProvider: "openai-codex", modelId: "gpt-5.5" }],
			[SANDBOX_ADDRESS.siloIdentityPath, { modelProvider: "anthropic", modelId: "claude-sonnet-5" }],
		]);
		const loadTokens = async (p: string): Promise<ModelTokens> => tokensByPath.get(p) ?? {};
		const operatorRoute = await safeModelRoute(OPERATOR_ADDRESS, loadTokens);
		const sandboxRoute = await safeModelRoute(SANDBOX_ADDRESS, loadTokens);
		expect(operatorRoute?.ref).toBe("openai-codex/gpt-5.5");
		expect(sandboxRoute?.ref).toBe("anthropic/claude-sonnet-5");
	});
});

describe("gatherNodeFacts — THE layer where both Criticals lived: proven fixed with literal addresses and injected readers", () => {
	it("engine: two literal addresses, one injected readEngineConfig keyed by path, produce DIFFERENT snapshots", async () => {
		const files = new Map<string, string>([
			[path.join(OPERATOR_ADDRESS.refarmHome, "config.json"), JSON.stringify({ tractor: { engine: "rust" } })],
			[path.join(SANDBOX_ADDRESS.refarmHome, "config.json"), JSON.stringify({ tractor: { engine: "ts" } })],
		]);
		const readEngineConfig = (p: string) => {
			const content = files.get(p);
			if (content === undefined) throw new Error(`ENOENT: ${p}`);
			return content;
		};
		const deps = {
			readEngineConfig,
			loadTokens: async (): Promise<ModelTokens> => ({}),
			fetchPluginState: async () => ({ reachable: false as const }),
		};
		const operatorFacts = await gatherNodeFacts("operator", OPERATOR_ADDRESS, deps);
		const sandboxFacts = await gatherNodeFacts("sandbox", SANDBOX_ADDRESS, deps);
		expect(operatorFacts.engine).toBe("rust");
		expect(sandboxFacts.engine).toBe("ts");
	});

	it("model-route: two literal addresses, one injected loadTokens keyed by path, produce DIFFERENT snapshots", async () => {
		const tokensByPath = new Map<string, ModelTokens>([
			[OPERATOR_ADDRESS.siloIdentityPath, { modelProvider: "openai-codex", modelId: "gpt-5.5" }],
			[SANDBOX_ADDRESS.siloIdentityPath, { modelProvider: "anthropic", modelId: "claude-sonnet-5" }],
		]);
		const deps = {
			readEngineConfig: () => {
				throw new Error("ENOENT");
			},
			loadTokens: async (p: string): Promise<ModelTokens> => tokensByPath.get(p) ?? {},
			fetchPluginState: async () => ({ reachable: false as const }),
		};
		const operatorFacts = await gatherNodeFacts("operator", OPERATOR_ADDRESS, deps);
		const sandboxFacts = await gatherNodeFacts("sandbox", SANDBOX_ADDRESS, deps);
		expect(operatorFacts.modelRoute?.ref).toBe("openai-codex/gpt-5.5");
		expect(sandboxFacts.modelRoute?.ref).toBe("anthropic/claude-sonnet-5");
	});

	it("plugin: a per-call fetchPluginState receives the address it was called for, not a shared one", async () => {
		const seen: string[] = [];
		const deps = {
			readEngineConfig: () => {
				throw new Error("ENOENT");
			},
			loadTokens: async (): Promise<ModelTokens> => ({}),
			fetchPluginState: async (address: ParityNodeAddress) => {
				seen.push(address.sidecarUrl);
				return { reachable: false as const };
			},
		};
		await gatherNodeFacts("operator", OPERATOR_ADDRESS, deps);
		await gatherNodeFacts("sandbox", SANDBOX_ADDRESS, deps);
		expect(seen).toEqual([OPERATOR_ADDRESS.sidecarUrl, SANDBOX_ADDRESS.sidecarUrl]);
	});

	it("an address of null (no node found) never reaches any injected reader — no facts to gather", async () => {
		const readEngineConfig = vi.fn(() => {
			throw new Error("should never be called");
		});
		const facts = await gatherNodeFacts("sandbox", null, { readEngineConfig });
		expect(readEngineConfig).not.toHaveBeenCalled();
		expect(facts).toEqual({ label: "sandbox", namespace: null, engine: null, modelRoute: null, plugin: { reachable: false } });
	});

	it("with readEngineConfig/loadTokens omitted, gatherNodeFacts falls back to the real readers — proves the injection is purely additive", async () => {
		// Genuinely exercises the real fs (readTractorEngineMode's default readFile) and the
		// real SiloCore against a path that does not exist — both degrade gracefully rather
		// than throwing, matching their own documented contracts. `fetchPluginState` is still
		// injected here so this test performs no real network I/O at all.
		const facts = await gatherNodeFacts(
			"operator",
			{
				...OPERATOR_ADDRESS,
				refarmHome: "/nonexistent/path/for/this/test/only",
				siloIdentityPath: "/nonexistent/path/for/this/test/only/identity.json",
			},
			{ fetchPluginState: async () => ({ reachable: false as const }) },
		);
		expect(facts.engine).toBe("auto");
		expect(facts.plugin).toEqual({ reachable: false });
	});
});
