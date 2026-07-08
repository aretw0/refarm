import { describe, expect, it } from "vitest";

import {
	buildBaseSurfaceModel,
	buildCapabilitySurfaceUnit,
	buildReviewQueueSurfaceUnit,
	createBaseSurfaceActionRows,
	formatBaseSurfaceActionSelectionChoices,
	formatBaseSurfaceModelText,
	resolveBaseSurfaceActionSelection,
	type BaseSurfaceUnit,
} from "./index.js";

describe("operator state model", () => {
	it("marks runtime not-ready as the first blocking base unit", () => {
		const model = buildBaseSurfaceModel(
			{
				runtime: {
					command: "runtime",
					operation: "status",
					ok: false,
					configuredEngine: "auto",
					activeEngine: "rust",
					ready: false,
					sidecarUrl: "http://127.0.0.1:42001",
					sidecarProbe: {
						url: "http://127.0.0.1:42001/efforts/summary",
						ready: false,
						error: "connect ECONNREFUSED 127.0.0.1:42001",
					},
					nextAction: "refarm runtime ensure --wait --next-command",
					nextActions: ["refarm runtime ensure --wait --next-command"],
					nextCommand: "refarm runtime ensure --wait --next-command",
					nextCommands: [
						"refarm runtime ensure --wait --next-command",
						"refarm doctor --next-command",
					],
				},
				model: {
					command: "model",
					operation: "current",
					ok: true,
					current: {
						ref: "openai-codex/gpt-5.3-codex-spark",
						provider: "openai-codex",
						modelId: "gpt-5.3-codex-spark",
					},
					credential: {
						state: "silo-oauth",
						status: "Silo OAuth (openai-codex)",
						envKey: "OPENAI_CODEX_ACCESS_TOKEN",
					},
					routes: {},
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				},
				health: {
					command: "health",
					operation: "audit",
					ok: true,
					issueCount: 0,
					recommendations: [],
					nextAction: null,
					nextActions: [],
					nextCommand: null,
					nextCommands: [],
				},
			},
			{ owner: "apps/refarm" },
		);

		expect(model.ok).toBe(false);
		expect(model.nextCommand).toBe("refarm runtime ensure --wait --next-command");
		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
		]);
		expect(model.units[0]).toMatchObject({
			id: "runtime",
			owner: "apps/refarm",
			state: "blocked",
			severity: "failure",
			summary: "Runtime sidecar is not ready.",
		});
		expect(model.units[0]?.evidence).toContainEqual({
			kind: "probe",
			label: "sidecar probe",
			value: "connect ECONNREFUSED 127.0.0.1:42001",
		});
		expect(model.units[1]).toMatchObject({
			id: "model",
			owner: "apps/refarm",
			state: "ready",
			severity: "info",
			summary: "Model route is configured.",
		});
	});

	it("keeps health policy failures actionable without inventing example-specific wording", () => {
		const model = buildBaseSurfaceModel(
			{
				health: {
					command: "health",
					operation: "audit",
					ok: false,
					issueCount: 1,
					recommendations: [
						{
							diagnostic: "git_ignored",
							issueType: "git_ignored",
							target:
								"packages/quality-checker-plugin/pkg-plugin/quality_plugin.js",
							summary:
								"packages/quality-checker-plugin/pkg-plugin/quality_plugin.js is ignored by Git.",
							action:
								"Track the source file, or add an explicit health policy exclusion if it is generated.",
							command: "refarm health suggest-policy --json",
						},
					],
					nextAction:
						"Track the source file, or add an explicit health policy exclusion if it is generated.",
					nextActions: [
						"Track the source file, or add an explicit health policy exclusion if it is generated.",
					],
					nextCommand: "refarm health suggest-policy --json",
					nextCommands: ["refarm health suggest-policy --json"],
				},
			},
			{ owner: "apps/refarm" },
		);

		expect(model.ok).toBe(false);
		expect(model.nextActions).toEqual([
			"Track the source file, or add an explicit health policy exclusion if it is generated.",
		]);
		expect(model.nextCommands).toEqual(["refarm health suggest-policy --json"]);
		expect(model.units[0]).toMatchObject({
			id: "health",
			owner: "apps/refarm",
			state: "blocked",
			severity: "failure",
			summary: "Workspace health has 1 blocking issue.",
		});
	});

	it("keeps runtime state coherent when the runtime reports ready with an issue", () => {
		const model = buildBaseSurfaceModel(
			{
				runtime: {
					command: "runtime",
					operation: "status",
					ok: false,
					configuredEngine: "rust",
					activeEngine: "unknown",
					ready: true,
					issue: "tractor.engine=rust but the Rust tractor binary is not built",
					nextCommand: "refarm config set tractor.engine auto",
					nextAction: "Select a usable runtime engine.",
				},
			},
			{ owner: "apps/refarm" },
		);

		expect(model.ok).toBe(false);
		expect(model.units[0]).toMatchObject({
			id: "runtime",
			owner: "apps/refarm",
			state: "blocked",
			severity: "failure",
			summary: "Runtime sidecar is not ready.",
		});
		expect(model.nextCommand).toBe("refarm config set tractor.engine auto");
		expect(model.nextAction).toBe("Select a usable runtime engine.");
	});

	it("dedupes plural and singular handoffs in runtime, model, health order", () => {
		const model = buildBaseSurfaceModel(
			{
				runtime: {
					command: "runtime",
					operation: "status",
					ok: false,
					ready: false,
					nextCommand: "refarm runtime status --json",
					nextCommands: ["refarm runtime status --json", "refarm resume --json"],
					nextAction: "Inspect runtime.",
					nextActions: ["Inspect runtime.", "Resume after runtime."],
				},
				model: {
					command: "model",
					operation: "current",
					ok: false,
					current: { ref: "openai-codex/gpt-5.3-codex-spark" },
					credential: { state: "missing" },
					nextCommand: "refarm sow --json",
					nextCommands: ["refarm runtime status --json", "refarm sow --json"],
					nextAction: "Configure credentials.",
					nextActions: ["Inspect runtime.", "Configure credentials."],
				},
				health: {
					command: "health",
					operation: "audit",
					ok: false,
					issueCount: 1,
					recommendations: [],
					nextCommand: "refarm health suggest-policy --json",
					nextCommands: ["refarm sow --json", "refarm health suggest-policy --json"],
					nextAction: "Fix health policy.",
					nextActions: ["Configure credentials.", "Fix health policy."],
				},
			},
			{ owner: "apps/refarm" },
		);

		expect(model.nextCommands).toEqual([
			"refarm runtime status --json",
			"refarm resume --json",
			"refarm sow --json",
			"refarm health suggest-policy --json",
		]);
		expect(model.nextActions).toEqual([
			"Inspect runtime.",
			"Resume after runtime.",
			"Configure credentials.",
			"Fix health policy.",
		]);
		expect(model.units[1]).toMatchObject({
			id: "model",
			owner: "apps/refarm",
			state: "blocked",
			severity: "failure",
			summary: "Model route is missing credentials.",
		});
	});

	it("lets non-Refarm consumers add domain units without app imports", () => {
		const walletUnit: BaseSurfaceUnit = {
			id: "wallet.verification",
			label: "Wallet Verification",
			owner: "examples/wallet-t2",
			state: "blocked",
			severity: "failure",
			summary: "Citizen wallet has records awaiting verification.",
			evidence: [{ kind: "count", label: "pending records", value: "2" }],
			actions: [
				{
					label: "Open wallet review queue.",
					command: "wallet-t2 review --pending --json",
					primary: true,
				},
			],
		};

		const model = buildBaseSurfaceModel({
			units: [walletUnit],
		});

		expect(model.ok).toBe(false);
		expect(model.units).toEqual([walletUnit]);
		expect(model.nextAction).toBe("Open wallet review queue.");
		expect(model.nextCommand).toBe("wallet-t2 review --pending --json");
	});

	it("projects base surface actions into stable selectable rows", () => {
		const rows = createBaseSurfaceActionRows([
			{
				label: "Open wallet",
				command: "dgk wallet --json",
				intent: "wallet:open",
			},
			{
				id: "verify-draft-credential",
				label: "Verify the draft credential",
				command: "dgk records correct record:draft verified --apply",
				intent: "wallet:verify",
			},
		]);

		expect(rows).toEqual([
			{
				index: 1,
				id: "dgk-wallet-json",
				label: "Open wallet",
				intent: "wallet:open",
				display: "[1] Open wallet — dgk-wallet-json (wallet:open)",
			},
			{
				index: 2,
				id: "verify-draft-credential",
				label: "Verify the draft credential",
				intent: "wallet:verify",
				display: "[2] Verify the draft credential — verify-draft-credential (wallet:verify)",
			},
		]);

		expect(resolveBaseSurfaceActionSelection(rows, "2")).toMatchObject({
			reason: "selected",
			selected: rows[1],
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "verify-draft-credential",
				index: 2,
			},
		});
		expect(resolveBaseSurfaceActionSelection(rows, "missing")).toMatchObject({
			reason: "missing-action",
			selection: { requested: "missing", source: "id" },
		});
		expect(resolveBaseSurfaceActionSelection([], "1")).toMatchObject({
			reason: "no-actions",
			selection: { requested: "1", source: "index" },
			rows: [],
		});
		expect(formatBaseSurfaceActionSelectionChoices(rows)).toBe(
			"[1] dgk-wallet-json, [2] verify-draft-credential",
		);
	});

	it("gives consumers helpers for capabilities, review queues and text output", () => {
		const capabilities = buildCapabilitySurfaceUnit(
			{ list: () => [{ name: "vault" }, { name: "records" }, { name: "wallet-show" }] },
			{
				owner: "examples/wallet-t2",
				subject: "Wallet",
				action: {
					label: "wallet wallet-show --json",
					command: "wallet wallet-show --json",
					primary: true,
				},
			},
		);
		const wallet = buildReviewQueueSurfaceUnit({
			id: "wallet",
			label: "Wallet",
			owner: "examples/wallet-t2",
			total: 3,
			pending: 1,
			totalLabel: "held items",
			pendingLabel: "needs review",
			pendingSummary: ({ total, pending }) =>
				`Wallet has ${total} held items; ${pending} item needs review.`,
			readySummary: ({ total }) => `Wallet has ${total} held items.`,
			pendingAction: {
				label: "Verify the draft credential",
				command: "wallet records correct record:cred-assinatura verified --apply",
				primary: true,
			},
		});
		const model = buildBaseSurfaceModel(
			{ units: [capabilities, wallet] },
			{ command: "wallet", operation: "base" },
		);

		expect(capabilities).toMatchObject({
			id: "capabilities",
			owner: "examples/wallet-t2",
			state: "ready",
			summary: "Wallet mounts 3 capability verbs.",
			evidence: [
				{ kind: "count", label: "verbs", value: "3" },
				{ kind: "state", label: "mounted", value: "vault, records, wallet-show" },
			],
		});
		expect(wallet).toMatchObject({
			id: "wallet",
			state: "degraded",
			severity: "warning",
			summary: "Wallet has 3 held items; 1 item needs review.",
		});
		expect(model.nextCommands).toEqual([
			"wallet wallet-show --json",
			"wallet records correct record:cred-assinatura verified --apply",
		]);
		expect(formatBaseSurfaceModelText(model, { title: "wallet base status" }))
			.toContain("Wallet: Wallet has 3 held items; 1 item needs review.");
	});
});
