import { readFileSync } from "node:fs";
import { createHomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";
import { createNullRuntimeSummary } from "@refarm.dev/runtime";
import { createNullTrustSummary } from "@refarm.dev/trust";
import { describe, expect, it } from "vitest";
import {
	assertRefarmStatusJson,
	buildRefarmStatusJson,
	classifyRefarmStatusDiagnostics,
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
	getRefarmStatusSchemaVersionIssue,
	isRefarmStatusJson,
	parseRefarmStatusJson,
	REFARM_STATUS_SCHEMA_VERSION,
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

describe("buildRefarmStatusJson", () => {
	it("emits schemaVersion 1 always", () => {
		expect(buildRefarmStatusJson(BASE_OPTIONS).schemaVersion).toBe(
			REFARM_STATUS_SCHEMA_VERSION,
		);
	});

	it("maps host fields directly", () => {
		expect(buildRefarmStatusJson(BASE_OPTIONS).host).toEqual({
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "headless",
		});
	});

	it("maps renderer id, kind, and capabilities from descriptor", () => {
		const result = buildRefarmStatusJson(BASE_OPTIONS);
		expect(result.renderer.id).toBe("refarm-headless");
		expect(result.renderer.kind).toBe("headless");
		expect(result.renderer.capabilities).toContain("telemetry");
		expect(result.renderer.capabilities).toContain("diagnostics");
	});

	it("defaults all plugin counts to zero when no snapshot is provided", () => {
		expect(buildRefarmStatusJson(BASE_OPTIONS).plugins).toEqual({
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		});
	});

	it("derives rejectedSurfaces and surfaceActions from snapshot surfaces", () => {
		const result = buildRefarmStatusJson({
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

	it("defaults streams to zero when not provided", () => {
		expect(buildRefarmStatusJson(BASE_OPTIONS).streams).toEqual({
			active: 0,
			terminal: 0,
		});
	});

	it("maps streams active and terminal from stream state", () => {
		const result = buildRefarmStatusJson({
			...BASE_OPTIONS,
			streams: { active: 3, terminal: 1 },
		});
		expect(result.streams).toEqual({ active: 3, terminal: 1 });
	});

	it("adds renderer and runtime diagnostics for headless null-runtime snapshots", () => {
		const diagnostics = buildRefarmStatusJson(BASE_OPTIONS).diagnostics;
		expect(diagnostics).toContain("renderer:non-interactive");
		expect(diagnostics).toContain("renderer:no-rich-html");
		expect(diagnostics).toContain("runtime:not-ready");
	});

	it("emits no renderer diagnostics for web renderer", () => {
		const webRenderer = createHomesteadHostRendererDescriptor(
			"refarm-web",
			"web",
		);
		const diagnostics = buildRefarmStatusJson({
			...BASE_OPTIONS,
			renderer: webRenderer,
		}).diagnostics;
		expect(diagnostics).not.toContain("renderer:non-interactive");
		expect(diagnostics).not.toContain("renderer:no-rich-html");
		expect(diagnostics).toContain("runtime:not-ready");
	});

	it("passes through null trust and runtime stubs unchanged", () => {
		const result = buildRefarmStatusJson(BASE_OPTIONS);
		expect(result.trust).toEqual({ profile: "dev", warnings: 0, critical: 0 });
		expect(result.runtime).toEqual({
			ready: false,
			databaseName: "",
			namespace: "",
		});
	});

	it("flags trust, plugin, and stream pressure diagnostics", () => {
		const diagnostics = buildRefarmStatusJson({
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
	it("accepts payloads built by buildRefarmStatusJson", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		expect(isRefarmStatusJson(json)).toBe(true);
		expect(() => assertRefarmStatusJson(json)).not.toThrow();
	});

	it("rejects payloads with incompatible schemaVersion", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		const invalid = { ...json, schemaVersion: 2 };
		expect(isRefarmStatusJson(invalid)).toBe(false);
		expect(() => assertRefarmStatusJson(invalid)).toThrow(
			/Unsupported Refarm status schemaVersion=2/,
		);
	});

	it("rejects payloads with malformed renderer capabilities", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		const invalid = {
			...json,
			renderer: { ...json.renderer, capabilities: ["surfaces", 1] },
		};
		expect(isRefarmStatusJson(invalid)).toBe(false);
	});

	it("provides explicit upgrade guidance for newer schema versions", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		const issue = getRefarmStatusSchemaVersionIssue({
			...json,
			schemaVersion: REFARM_STATUS_SCHEMA_VERSION + 1,
		});
		expect(issue?.reason).toBe("newer");
		expect(issue?.message).toMatch(/Upgrade @refarm.dev\/cli/);
	});

	it("provides regeneration guidance for older schema versions", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		const issue = getRefarmStatusSchemaVersionIssue({
			...json,
			schemaVersion: REFARM_STATUS_SCHEMA_VERSION - 1,
		});
		expect(issue?.reason).toBe("older");
		expect(issue?.message).toMatch(/Regenerate with a newer status producer/);
	});

	it("parses valid status json strings", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		const parsed = parseRefarmStatusJson(formatRefarmStatusJson(json));
		expect(parsed).toEqual(json);
	});

	it("fails with actionable error on newer parsed schema", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		const newerPayload = JSON.stringify({
			...json,
			schemaVersion: REFARM_STATUS_SCHEMA_VERSION + 1,
		});

		expect(() => parseRefarmStatusJson(newerPayload)).toThrow(
			/Upgrade @refarm.dev\/cli/,
		);
	});

	it("fails for non-json strings", () => {
		expect(() => parseRefarmStatusJson("not-json")).toThrow(
			/Invalid JSON for Refarm status payload/,
		);
	});
});

describe("classifyRefarmStatusDiagnostics", () => {
	it("splits diagnostics into failure, warning and informational groups", () => {
		const summary = classifyRefarmStatusDiagnostics(
			buildRefarmStatusJson({
				...BASE_OPTIONS,
				trust: { profile: "strict", warnings: 1, critical: 1 },
				streams: { active: 1, terminal: 0 },
				plugins: {
					surfaces: {
						rejected: [{ reason: "untrusted-plugin", pluginId: "plugin-a" }],
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
		expect(summary.hasFailure).toBe(true);
	});

	it("supports caller-provided severity overrides", () => {
		const summary = classifyRefarmStatusDiagnostics(
			buildRefarmStatusJson(BASE_OPTIONS),
			{
				failureCodes: ["renderer:no-rich-html"],
				warningCodes: ["runtime:not-ready"],
			},
		);

		expect(summary.failures).toEqual(["renderer:no-rich-html"]);
		expect(summary.warnings).toContain("runtime:not-ready");
	});
});

describe("formatRefarmStatusMarkdown", () => {
	it("renders a markdown report with diagnostics list", () => {
		const report = formatRefarmStatusMarkdown(
			buildRefarmStatusJson(BASE_OPTIONS),
		);
		expect(report.startsWith("---\nschemaVersion: 1\nhost:\n")).toBe(true);
		expect(report).toContain(
			'renderer:\n  id: "refarm-headless"\n  kind: "headless"',
		);
		expect(report).toContain("# Refarm Status");
		expect(report).toContain("- Schema: v1");
		expect(report).toContain("## Diagnostics");
		expect(report).toContain("- renderer:non-interactive");
	});

	it("prints '- none' when diagnostics are empty", () => {
		const webRenderer = createHomesteadHostRendererDescriptor(
			"refarm-web",
			"web",
		);
		const report = formatRefarmStatusMarkdown(
			buildRefarmStatusJson({
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

describe("formatRefarmStatusJson", () => {
	it("matches the schema v1 golden snapshot", () => {
		const json = buildRefarmStatusJson(BASE_OPTIONS);
		expect(formatRefarmStatusJson(json)).toBe(STATUS_JSON_GOLDEN);
	});

	it("normalizes key ordering for equivalent payloads", () => {
		const base = buildRefarmStatusJson(BASE_OPTIONS);
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

		expect(formatRefarmStatusJson(scrambled)).toBe(
			formatRefarmStatusJson(base),
		);
	});
});
