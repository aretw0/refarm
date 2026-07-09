import { createHomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";
import { createNullRuntimeSummary } from "@refarm.dev/runtime";
import { createNullTrustSummary } from "@refarm.dev/trust";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	assertStatusJson,
	buildStatusJson,
	classifyStatusDiagnostics,
	formatStatusJson,
	formatStatusMarkdown,
	formatStatusSummary,
	getStatusSchemaVersionIssue,
	isStatusJson,
	parseStatusJson,
	STATUS_DIAGNOSTICS,
	STATUS_FAILURE_DIAGNOSTICS,
	STATUS_INFORMATIONAL_DIAGNOSTICS,
	STATUS_SCHEMA_VERSION,
	STATUS_WARNING_DIAGNOSTICS,
} from "./status.js";

const STATUS_JSON_GOLDEN = readFileSync(
	new URL("./__fixtures__/refarm-status-v1.golden.json", import.meta.url),
	"utf-8",
).trimEnd();

const HEADLESS_RENDERER = createHomesteadHostRendererDescriptor(
	"refarm-headless",
	"headless",
);

const BASE_OPTIONS = {
	host: {
		app: "apps/refarm",
		command: "refarm",
		profile: "dev",
		mode: "headless",
	},
	renderer: HEADLESS_RENDERER,
	runtime: createNullRuntimeSummary(),
	trust: createNullTrustSummary(),
};

describe("buildStatusJson", () => {
	it("emits schemaVersion 1 always", () => {
		expect(buildStatusJson(BASE_OPTIONS).schemaVersion).toBe(
			STATUS_SCHEMA_VERSION,
		);
	});

	it("publishes stable status diagnostic code groups", () => {
		expect(STATUS_FAILURE_DIAGNOSTICS).toEqual([
			STATUS_DIAGNOSTICS.runtimeNotReady,
			STATUS_DIAGNOSTICS.runtimeSidecarAccessBlocked,
			STATUS_DIAGNOSTICS.trustCriticalPresent,
		]);
		expect(STATUS_WARNING_DIAGNOSTICS).toContain(
			STATUS_DIAGNOSTICS.pluginsRejectedSurfacesPresent,
		);
		expect(STATUS_INFORMATIONAL_DIAGNOSTICS).toContain(
			STATUS_DIAGNOSTICS.pluginsSurfaceActionsAvailable,
		);
	});

	it("maps host fields directly", () => {
		expect(buildStatusJson(BASE_OPTIONS).host).toEqual({
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "headless",
		});
	});

	it("maps renderer id, kind, and capabilities from descriptor", () => {
		const result = buildStatusJson(BASE_OPTIONS);
		expect(result.renderer.id).toBe("refarm-headless");
		expect(result.renderer.kind).toBe("headless");
		expect(result.renderer.capabilities).toContain("telemetry");
		expect(result.renderer.capabilities).toContain("diagnostics");
	});

	it("defaults all plugin counts to zero when no snapshot is provided", () => {
		expect(buildStatusJson(BASE_OPTIONS).plugins).toEqual({
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		});
	});

	it("derives rejectedSurfaces and surfaceActions from snapshot surfaces", () => {
		const result = buildStatusJson({
			...BASE_OPTIONS,
			plugins: {
				surfaces: {
					rejected: [{ reason: "untrusted-plugin", pluginId: "plugin-a" }],
					actions: [
						{
							actionId: "open-node",
							status: "requested",
							pluginId: "plugin-b",
						},
						{ actionId: "close-node", status: "failed", pluginId: "plugin-c" },
					],
				},
			},
		});
		expect(result.plugins.rejectedSurfaces).toBe(1);
		expect(result.plugins.surfaceActions).toBe(2);
	});

	it("prefers available surface actions over historical action telemetry", () => {
		const result = buildStatusJson({
			...BASE_OPTIONS,
			plugins: {
				surfaces: {
					availableActions: [
						{
							id: "open-node",
							label: "Open node",
							intent: "node:open",
						},
					],
					actions: [
						{
							actionId: "historical-open-node",
							status: "requested",
						},
						{
							actionId: "historical-close-node",
							status: "failed",
						},
					],
				},
			},
		});

		expect(result.plugins.surfaceActions).toBe(1);
		expect(result.plugins.availableActions).toEqual([
			{ id: "open-node", label: "Open node", intent: "node:open" },
		]);
	});

	it("preserves invocable surface action payloads for readiness handoff", () => {
		const command = "host action run open-node";
		const result = buildStatusJson({
			...BASE_OPTIONS,
			plugins: {
				surfaces: {
					availableActions: [
						{
							id: "open-node",
							label: "Open node",
							intent: "node:open",
							payload: { command, target: "node" },
						},
					],
				},
			},
		});

		expect(result.plugins.availableActions).toEqual([
			{
				id: "open-node",
				label: "Open node",
				intent: "node:open",
				payload: { command, target: "node" },
			},
		]);
	});

	it("defaults streams to zero when not provided", () => {
		expect(buildStatusJson(BASE_OPTIONS).streams).toEqual({
			active: 0,
			terminal: 0,
		});
	});

	it("maps streams active and terminal from stream state", () => {
		const result = buildStatusJson({
			...BASE_OPTIONS,
			streams: { active: 3, terminal: 1 },
		});
		expect(result.streams).toEqual({ active: 3, terminal: 1 });
	});

	it("adds renderer and runtime diagnostics for headless null-runtime snapshots", () => {
		const diagnostics = buildStatusJson(BASE_OPTIONS).diagnostics;
		expect(diagnostics).toContain("renderer:non-interactive");
		expect(diagnostics).toContain("renderer:no-rich-html");
		expect(diagnostics).toContain("runtime:not-ready");
	});

	it("classifies sidecar permission failures separately from runtime readiness", () => {
		const diagnostics = buildStatusJson({
			...BASE_OPTIONS,
			runtime: {
				ready: false,
				databaseName: "refarm-main",
				namespace: "refarm-main",
				error:
					"fetch failed: connect EPERM 127.0.0.1:42001 - Local (undefined:undefined)",
			},
		}).diagnostics;

		expect(diagnostics).toContain("runtime:sidecar-access-blocked");
		expect(diagnostics).not.toContain("runtime:not-ready");
	});

	it("adds an informational diagnostic when surface actions are available", () => {
		const diagnostics = buildStatusJson({
			...BASE_OPTIONS,
			plugins: {
				surfaces: {
					availableActions: [{ id: "open-node", label: "Open node" }],
				},
			},
		}).diagnostics;

		expect(diagnostics).toContain("plugins:surface-actions-available");
	});

	it("emits no renderer diagnostics for web renderer", () => {
		const webRenderer = createHomesteadHostRendererDescriptor(
			"refarm-web",
			"web",
		);
		const diagnostics = buildStatusJson({
			...BASE_OPTIONS,
			renderer: webRenderer,
		}).diagnostics;
		expect(diagnostics).not.toContain("renderer:non-interactive");
		expect(diagnostics).not.toContain("renderer:no-rich-html");
		expect(diagnostics).toContain("runtime:not-ready");
	});

	it("passes through null trust and runtime stubs unchanged", () => {
		const result = buildStatusJson(BASE_OPTIONS);
		expect(result.trust).toEqual({ profile: "dev", warnings: 0, critical: 0 });
		expect(result.runtime).toEqual({
			ready: false,
			databaseName: "",
			namespace: "",
		});
	});

	it("preserves optional tractor engine runtime details", () => {
		const result = buildStatusJson({
			...BASE_OPTIONS,
			runtime: {
				ready: true,
				databaseName: "refarm-main",
				namespace: "refarm-main",
				engine: {
					configuredEngine: "auto",
					activeEngine: "ts",
				},
			},
		});

		expect(result.runtime.engine).toEqual({
			configuredEngine: "auto",
			activeEngine: "ts",
		});
		expect(formatStatusJson(result)).toContain('"engine": {');
	});

	it("flags trust, plugin, and stream pressure diagnostics", () => {
		const diagnostics = buildStatusJson({
			...BASE_OPTIONS,
			trust: { profile: "strict", warnings: 1, critical: 2 },
			streams: { active: 2, terminal: 1 },
			plugins: {
				surfaces: {
					rejected: [{ reason: "untrusted-plugin", pluginId: "plugin-a" }],
					actions: [],
				},
			},
		}).diagnostics;

		expect(diagnostics).toContain("trust:warnings-present");
		expect(diagnostics).toContain("trust:critical-present");
		expect(diagnostics).toContain("plugins:rejected-surfaces-present");
		expect(diagnostics).toContain("streams:active-present");
	});
});

describe("status contract validation", () => {
	it("accepts payloads built by buildStatusJson", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		expect(isStatusJson(json)).toBe(true);
		expect(() => assertStatusJson(json)).not.toThrow();
	});

	it("rejects payloads with incompatible schemaVersion", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		const invalid = { ...json, schemaVersion: 2 };
		expect(isStatusJson(invalid)).toBe(false);
		expect(() => assertStatusJson(invalid)).toThrow(
			/Unsupported status schemaVersion=2/,
		);
	});

	it("validates optional available action details", () => {
		const json = buildStatusJson({
			...BASE_OPTIONS,
			plugins: {
				surfaces: {
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
					],
				},
			},
		});

		expect(isStatusJson(json)).toBe(true);
		expect(
			isStatusJson({
				...json,
				plugins: {
					...json.plugins,
					availableActions: [{ id: "open-node" }],
				},
			}),
		).toBe(false);
	});

	it("validates optional tractor engine details", () => {
		const json = buildStatusJson({
			...BASE_OPTIONS,
			runtime: {
				ready: true,
				databaseName: "refarm-main",
				namespace: "refarm-main",
				engine: {
					configuredEngine: "rust",
					activeEngine: "ts",
				},
			},
		});

		expect(isStatusJson(json)).toBe(true);
		expect(
			isStatusJson({
				...json,
				runtime: {
					...json.runtime,
					engine: { configuredEngine: "python" },
				},
			}),
		).toBe(false);
	});

	it("validates optional runtime error details", () => {
		const json = buildStatusJson({
			...BASE_OPTIONS,
			runtime: {
				ready: false,
				databaseName: "refarm-main",
				namespace: "refarm-main",
				error: "fetch failed: connect EPERM 127.0.0.1:42001",
			},
		});

		expect(isStatusJson(json)).toBe(true);
		expect(
			isStatusJson({
				...json,
				runtime: {
					...json.runtime,
					error: 403,
				},
			}),
		).toBe(false);
	});

	it("rejects payloads with malformed renderer capabilities", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		const invalid = {
			...json,
			renderer: { ...json.renderer, capabilities: ["surfaces", 1] },
		};
		expect(isStatusJson(invalid)).toBe(false);
	});

	it("provides explicit upgrade guidance for newer schema versions", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		const issue = getStatusSchemaVersionIssue({
			...json,
			schemaVersion: STATUS_SCHEMA_VERSION + 1,
		});
		expect(issue?.reason).toBe("newer");
		expect(issue?.message).toMatch(/Upgrade @refarm.dev\/cli/);
	});

	it("provides regeneration guidance for older schema versions", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		const issue = getStatusSchemaVersionIssue({
			...json,
			schemaVersion: STATUS_SCHEMA_VERSION - 1,
		});
		expect(issue?.reason).toBe("older");
		expect(issue?.message).toMatch(/Regenerate with a newer status producer/);
	});

	it("parses valid status json strings", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		const parsed = parseStatusJson(formatStatusJson(json));
		expect(parsed).toEqual(json);
	});

	it("fails with actionable error on newer parsed schema", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		const newerPayload = JSON.stringify({
			...json,
			schemaVersion: STATUS_SCHEMA_VERSION + 1,
		});

		expect(() => parseStatusJson(newerPayload)).toThrow(
			/Upgrade @refarm.dev\/cli/,
		);
	});

	it("fails for non-json strings", () => {
		expect(() => parseStatusJson("not-json")).toThrow(
			/Invalid JSON for status payload/,
		);
	});
});

describe("classifyStatusDiagnostics", () => {
	it("splits diagnostics into failure, warning and informational groups", () => {
		const summary = classifyStatusDiagnostics(
			buildStatusJson({
				...BASE_OPTIONS,
				trust: { profile: "strict", warnings: 1, critical: 1 },
				streams: { active: 1, terminal: 0 },
				plugins: {
					surfaces: {
						rejected: [{ reason: "untrusted-plugin", pluginId: "plugin-a" }],
						availableActions: [{ id: "open-node", label: "Open node" }],
						actions: [],
					},
				},
			}),
		);

		expect(summary.failures).toContain("runtime:not-ready");
		expect(summary.failures).toContain("trust:critical-present");
		expect(summary.warnings).toContain("trust:warnings-present");
		expect(summary.warnings).toContain("plugins:rejected-surfaces-present");
		expect(summary.warnings).toContain("streams:active-present");
		expect(summary.informational).toContain("renderer:non-interactive");
		expect(summary.informational).toContain(
			"plugins:surface-actions-available",
		);
		expect(summary.hasFailure).toBe(true);
	});

	it("supports caller-provided severity overrides", () => {
		const summary = classifyStatusDiagnostics(
			buildStatusJson(BASE_OPTIONS),
			{
				failureCodes: ["renderer:no-rich-html"],
				warningCodes: ["runtime:not-ready"],
			},
		);

		expect(summary.failures).toEqual(["renderer:no-rich-html"]);
		expect(summary.warnings).toContain("runtime:not-ready");
	});
});

describe("formatStatusMarkdown", () => {
	it("renders a markdown report with diagnostics list", () => {
		const report = formatStatusMarkdown(
			buildStatusJson(BASE_OPTIONS),
		);
		expect(report.startsWith("---\nschemaVersion: 1\nhost:\n")).toBe(true);
		expect(report).toContain(
			'renderer:\n  id: "refarm-headless"\n  kind: "headless"',
		);
		expect(report).toContain("# Status");
		expect(report).toContain("- Schema: v1");
		expect(report).toContain("- Surfaces: 0 rejected, 0 actions");
		expect(report).toContain("## Available Actions\n- none");
		expect(report).toContain("## Diagnostics");
		expect(report).toContain("- renderer:non-interactive");
	});

	it("renders available action details in markdown reports", () => {
		const report = formatStatusMarkdown(
			buildStatusJson({
				...BASE_OPTIONS,
				plugins: {
					surfaces: {
						availableActions: [
							{ id: "open-node", label: "Open node", intent: "node:open" },
						],
					},
				},
			}),
		);

		expect(report).toContain(
			"## Available Actions\n- open-node: Open node (node:open)",
		);
	});

	it("prints '- none' when diagnostics are empty", () => {
		const webRenderer = createHomesteadHostRendererDescriptor(
			"refarm-web",
			"web",
		);
		const report = formatStatusMarkdown(
			buildStatusJson({
				...BASE_OPTIONS,
				renderer: webRenderer,
				runtime: {
					ready: true,
					databaseName: "refarm-main",
					namespace: "refarm-main",
				},
			}),
		);
		expect(report).toContain("## Diagnostics\n- none");
	});
});

describe("formatStatusSummary", () => {
	it("renders a deterministic operator summary", () => {
		const summary = formatStatusSummary(
			buildStatusJson(BASE_OPTIONS),
		);
		expect(summary).toContain("Host:      apps/refarm (headless)");
		expect(summary).toContain("Renderer:  refarm-headless (headless)");
		expect(summary).toContain("Surfaces:  0 rejected, 0 actions");
		expect(summary).toContain("Diagnostics:");
		expect(summary).toContain("  - runtime:not-ready");
	});

	it("renders tractor engine details in operator summaries", () => {
		const summary = formatStatusSummary(
			buildStatusJson({
				...BASE_OPTIONS,
				runtime: {
					ready: true,
					databaseName: "refarm-main",
					namespace: "refarm-main",
					engine: {
						configuredEngine: "rust",
						activeEngine: "ts",
					},
				},
			}),
		);

		expect(summary).toContain(
			"Runtime:   ready — refarm-main (engine: ts, configured: rust)",
		);
	});

	it("renders available action details in operator summaries", () => {
		const summary = formatStatusSummary(
			buildStatusJson({
				...BASE_OPTIONS,
				plugins: {
					surfaces: {
						availableActions: [
							{ id: "open-node", label: "Open node", intent: "node:open" },
						],
					},
				},
			}),
		);

		expect(summary).toContain("Available actions:");
		expect(summary).toContain("  - open-node: Open node (node:open)");
	});

	it("omits diagnostics section when no diagnostics are present", () => {
		const webRenderer = createHomesteadHostRendererDescriptor(
			"refarm-web",
			"web",
		);
		const summary = formatStatusSummary(
			buildStatusJson({
				...BASE_OPTIONS,
				renderer: webRenderer,
				runtime: {
					ready: true,
					databaseName: "refarm-main",
					namespace: "refarm-main",
				},
			}),
		);
		expect(summary).not.toContain("Diagnostics:");
	});
});

describe("formatStatusJson", () => {
	it("matches the schema v1 golden snapshot", () => {
		const json = buildStatusJson(BASE_OPTIONS);
		expect(formatStatusJson(json)).toBe(STATUS_JSON_GOLDEN);
	});

	it("preserves optional available action details in canonical JSON", () => {
		const json = buildStatusJson({
			...BASE_OPTIONS,
			plugins: {
				surfaces: {
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
					],
				},
			},
		});

		expect(formatStatusJson(json)).toContain('"availableActions": [');
		expect(parseStatusJson(formatStatusJson(json))).toMatchObject({
			plugins: {
				availableActions: [
					{ id: "open-node", label: "Open node", intent: "node:open" },
				],
			},
		});
	});

	it("normalizes key ordering for equivalent payloads", () => {
		const base = buildStatusJson(BASE_OPTIONS);
		const scrambled: typeof base = {
			diagnostics: [...base.diagnostics],
			streams: { ...base.streams },
			trust: { ...base.trust },
			plugins: { ...base.plugins },
			runtime: {
				namespace: base.runtime.namespace,
				databaseName: base.runtime.databaseName,
				ready: base.runtime.ready,
			},
			renderer: {
				capabilities: [...base.renderer.capabilities],
				kind: base.renderer.kind,
				id: base.renderer.id,
			},
			host: {
				mode: base.host.mode,
				profile: base.host.profile,
				command: base.host.command,
				app: base.host.app,
			},
			schemaVersion: base.schemaVersion,
		};

		expect(formatStatusJson(scrambled)).toBe(
			formatStatusJson(base),
		);
	});
});
