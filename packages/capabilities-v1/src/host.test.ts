import type { RecordsManifest } from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	defineCapabilityHost,
	type RefarmCapabilityDeps,
} from "./index.js";

function deps(): RefarmCapabilityDeps {
	return {
		source: defaultSourceDeps(),
		vault: defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async (effort) => effort.id,
		}),
		records: defaultRecordsDeps(),
	};
}

const showVerb: CapabilityDescriptor = {
	name: "wallet",
	summary: "Show the citizen wallet",
	transports: {
		cli: {},
		repl: {},
		http: { method: "GET", path: "/wallet" },
		agent: { tool: true, toolName: "wallet" },
	},
	renderers: { tui: { section: "wallet" } },
	run: () =>
		buildJsonSuccessEnvelope({
			command: "wallet",
			operation: "render",
			nextCommand: "records list",
			extra: { held: 3 },
		}),
};

describe("defineCapabilityHost", () => {
	it("lets a white-label app declare extensions once and get registry, CLI, HTTP and base status", async () => {
		const host = defineCapabilityHost({
			id: "examples/wallet-t2",
			command: "dgk",
			description: "Digital Gardening Kit - sovereign wallet",
			version: "0.0.0",
			capabilities: {
				deps: deps(),
				extensions: [showVerb],
			},
			operatorStatus: {
				summary: "Show wallet operator status",
				httpPath: "/wallet/status",
				capabilityUnit: {
					subject: "Wallet",
					action: {
						id: "open-wallet",
						label: "dgk wallet --json",
						intent: "wallet:open",
						command: "dgk wallet --json",
						primary: true,
					},
				},
				units: ({ reviewQueueUnit }) => [
					reviewQueueUnit({
						id: "wallet",
						label: "Wallet",
						total: 3,
						pending: 1,
						totalLabel: "held items",
						pendingLabel: "needs review",
						pendingAction: {
							id: "verify-draft-credential",
							label: "Verify the draft credential",
							intent: "wallet:verify",
							command: "dgk records correct record:cred-assinatura verified --apply",
							primary: true,
						},
					}),
				],
			},
			serve: { defaultPort: 0 },
		});

		const registry = host.registry();
		expect(registry.list().map((entry) => entry.name)).toEqual(
			expect.arrayContaining(["source", "records", "vault", "wallet", "status", "actions"]),
		);
		const wallet = registry.get("wallet");
		if (!wallet || "actions" in wallet) throw new Error("wallet verb not mounted");
		const walletEnvelope = await wallet.run({ args: {}, options: {}, json: true }) as unknown as {
			nextCommand: string;
			nextCommands: string[];
		};
		expect(walletEnvelope.nextCommand).toBe("dgk records list");
		expect(walletEnvelope.nextCommands).toEqual(["dgk records list"]);

		const model = host.baseModel();
		expect(model).toMatchObject({
			schemaVersion: 1,
			command: "dgk",
			operation: "base",
			ok: true,
			nextCommand: "dgk wallet --json",
		});
		expect(model.units.map((unit) => unit.id)).toEqual(["capabilities", "wallet"]);
		expect(model.units.every((unit) => unit.owner === "examples/wallet-t2")).toBe(true);
		expect(JSON.stringify(model)).not.toContain("apps/refarm");
		expect(host.surfaceActions()).toEqual([
			expect.objectContaining({
				id: "open-wallet",
				label: "dgk wallet --json",
				intent: "wallet:open",
				payload: expect.objectContaining({ command: "dgk wallet --json" }),
			}),
			expect.objectContaining({
				id: "verify-draft-credential",
				label: "Verify the draft credential",
				intent: "wallet:verify",
				payload: expect.objectContaining({
					command: "dgk records correct record:cred-assinatura verified --apply",
				}),
			}),
		]);

		const actions = registry.get("actions");
		if (!actions || "actions" in actions) throw new Error("actions not mounted");
		const actionEnvelope = await actions.run({ args: {}, options: {}, json: true }) as unknown as {
			command: string;
			operation: string;
			actionRows: Array<{ id: string; display: string }>;
		};
		expect(actionEnvelope).toMatchObject({
			command: "actions",
			operation: "surface-actions",
		});
		expect(actionEnvelope.actionRows.map((row) => row.id)).toEqual([
			"open-wallet",
			"verify-draft-credential",
		]);

		const program = host.program();
		expect(program.name()).toBe("dgk");
		expect(program.description()).toBe("Digital Gardening Kit - sovereign wallet");
		expect(program.commands.map((command: { name(): string }) => command.name())).toEqual(
			expect.arrayContaining(["source", "records", "vault", "wallet", "status", "actions", "serve"]),
		);

		const { listening, close } = host.serve({ port: 0 });
		try {
			const { port } = await listening;
			const res = await fetch(`http://127.0.0.1:${port}/capabilities/wallet/status`);
			expect(res.status).toBe(200);
			const body = await res.json() as { command: string; units: Array<{ id: string }> };
			expect(body.command).toBe("dgk");
			expect(body.units.map((unit) => unit.id)).toEqual(["capabilities", "wallet"]);
		} finally {
			await close();
		}
	});

	it("lets a host declare a records review queue without manifest plumbing", () => {
		const host = defineCapabilityHost({
			id: "examples/wallet-t2",
			command: "dgk",
			description: "Digital Gardening Kit - sovereign wallet",
			capabilities: {
				deps: {
					...deps(),
					records: {
						...defaultRecordsDeps(),
						loadManifest: () => ({
							manifestVersion: 1,
							records: [
								{ id: "record:draft", review: { state: "draft" } },
								{ id: "record:verified", review: { state: "verified" } },
							],
						} as RecordsManifest),
					},
				},
				extensions: [showVerb],
			},
			operatorStatus: {
				capabilityUnit: false,
				units: ({ recordReviewQueueUnit }) => [
					recordReviewQueueUnit({
						id: "wallet",
						label: "Wallet",
						reviewedState: "verified",
						totalLabel: "held items",
						pendingLabel: "needs review",
						pendingSummary: ({ total, pending }) =>
							`Wallet has ${total} held items; ${pending} item needs review.`,
						readySummary: ({ total }) => `Wallet has ${total} held items.`,
						pendingAction: {
							id: "verify-draft-credential",
							label: "Verify the draft credential",
							intent: "wallet:verify",
							command: "dgk records correct record:draft verified --apply",
							primary: true,
						},
					}),
				],
			},
		});

		const model = host.baseModel();
		expect(model.units).toHaveLength(1);
		expect(model.units[0]).toMatchObject({
			id: "wallet",
			state: "degraded",
			severity: "warning",
			summary: "Wallet has 2 held items; 1 item needs review.",
			details: {
				recordIds: ["record:draft", "record:verified"],
				pendingRecordIds: ["record:draft"],
				reviewedState: "verified",
			},
		});
		expect(model.nextCommands).toEqual([
			"dgk records correct record:draft verified --apply",
		]);
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"verify-draft-credential",
		]);
	});
});
