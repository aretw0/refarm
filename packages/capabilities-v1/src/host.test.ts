import type { RecordsManifest } from "@refarm.dev/records-contract-v1";
import { describe, expect, it, vi } from "vitest";

import {
	buildJsonSuccessEnvelope,
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	defineCapabilityHost,
	isCapabilityHostCliEntrypoint,
	runCapabilityHostCli,
	type CapabilityDeps,
	type CapabilityDescriptor,
} from "./index.js";

function deps(): CapabilityDeps {
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
				capabilityUnit: ({ hostCommand }) => ({
					subject: "Wallet",
					action: {
						id: "open-wallet",
						label: hostCommand(["wallet", "--json"]),
						intent: "wallet:open",
						command: hostCommand(["wallet", "--json"]),
						primary: true,
					},
				}),
				units: ({ reviewQueueUnit, hostCommand }) => [
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
							command: hostCommand([
								"records",
								"correct",
								"record:cred-assinatura",
								"verified",
								"--apply",
							]),
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
		const selectedActionEnvelope = await actions.run({
			args: {},
			options: { select: "2", renderer: "tui" },
			json: true,
		}) as unknown as {
			actionRequest: {
				ok: boolean;
				reason: string;
				command?: string;
				payload?: Record<string, unknown>;
				selectedAction?: {
					id: string;
					label: string;
					payload: Record<string, unknown>;
				};
				nextCommand: string | null;
				nextCommands: string[];
			};
			nextCommand: string | null;
			nextCommands: string[];
		};
		expect(selectedActionEnvelope.actionRequest).toMatchObject({
			ok: true,
			reason: "selected",
			command: "dgk records correct record:cred-assinatura verified --apply",
			payload: expect.objectContaining({
				command: "dgk records correct record:cred-assinatura verified --apply",
				hostId: "examples/wallet-t2",
				unitId: "wallet",
				unitLabel: "Wallet",
				primary: true,
			}),
			selectedAction: {
				id: "verify-draft-credential",
				label: "Verify the draft credential",
				payload: expect.objectContaining({
					command: "dgk records correct record:cred-assinatura verified --apply",
				}),
			},
			nextCommand: "dgk records correct record:cred-assinatura verified --apply",
			nextCommands: ["dgk records correct record:cred-assinatura verified --apply"],
		});
		expect(selectedActionEnvelope.nextCommand).toBe(
			"dgk records correct record:cred-assinatura verified --apply",
		);
		expect(selectedActionEnvelope.nextCommands).toEqual([
			"dgk records correct record:cred-assinatura verified --apply",
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

	it("lets a host declare white-label OpenAPI metadata for its served capability surface", async () => {
		const host = defineCapabilityHost({
			id: "examples/wallet-t2",
			command: "dgk",
			description: "Digital Gardening Kit - sovereign wallet",
			version: "0.0.0",
			capabilities: {
				deps: deps(),
				extensions: [showVerb],
			},
			serve: {
				defaultPort: 0,
				openApiPath: "/docs/openapi.json",
				openApiTitle: "DGK Wallet API",
				openApiVersion: "2.0.0",
			},
		});

		const { listening, close } = host.serve({ port: 0 });
		try {
			const { port } = await listening;
			const defaultSpec = await fetch(`http://127.0.0.1:${port}/openapi.json`);
			expect(defaultSpec.status).toBe(404);

			const res = await fetch(`http://127.0.0.1:${port}/docs/openapi.json`);
			expect(res.status).toBe(200);
			const spec = await res.json() as {
				openapi: string;
				info: { title: string; version: string };
				paths: Record<string, unknown>;
			};
			expect(spec.openapi).toBe("3.1.0");
			expect(spec.info).toEqual({
				title: "DGK Wallet API",
				version: "2.0.0",
			});
			expect(Object.keys(spec.paths)).toContain("/capabilities/wallet");
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
				units: ({ recordReviewQueueUnit, hostCommand }) => [
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
							command: hostCommand([
								"records",
								"correct",
								"record:draft",
								"verified",
								"--apply",
							]),
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

	it("builds a record correction action from the first pending record", () => {
		const host = defineCapabilityHost({
			id: "examples/reqbench-t3",
			command: "dgk",
			description: "Digital Gardening Kit - requirements bench",
			capabilities: {
				deps: {
					...deps(),
					records: {
						...defaultRecordsDeps(),
						loadManifest: () => ({
							manifestVersion: 1,
							records: [
								{ id: "record:req-draft", review: { state: "draft" } },
								{ id: "record:req-reviewed", review: { state: "reviewed" } },
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
						id: "requirements",
						label: "Requirements",
						reviewedState: "reviewed",
						totalLabel: "requirements",
						pendingLabel: "needs review",
						pendingCorrection: {
							targetState: "reviewed",
							actionId: "review-draft-requirement",
							label: "Review the draft requirement",
							intent: "requirements:review",
						},
					}),
				],
			},
		});

		expect(host.baseModel().nextCommands).toEqual([
			"dgk records correct record:req-draft reviewed --apply",
		]);
		expect(host.surfaceActions()).toEqual([
			expect.objectContaining({
				id: "review-draft-requirement",
				label: "Review the draft requirement",
				intent: "requirements:review",
				payload: expect.objectContaining({
					command: "dgk records correct record:req-draft reviewed --apply",
				}),
			}),
		]);
	});

	it("builds a primary extension action from a verb declaration", () => {
		const host = defineCapabilityHost({
			id: "examples/devbench-t1",
			command: "dgk",
			description: "Digital Gardening Kit - extension bench",
			capabilities: {
				deps: deps(),
				extensions: [showVerb],
			},
			operatorStatus: {
				primaryVerb: {
					name: "wallet",
					subject: "Extension bench",
					actionId: "inspect-extension",
					intent: "extension:inspect",
				},
			},
		});

		expect(host.baseModel()).toMatchObject({
			nextCommand: "dgk wallet --json",
			units: [
				expect.objectContaining({
					id: "capabilities",
					summary: "Extension bench mounts 6 capability verbs.",
				}),
			],
		});
		expect(host.surfaceActions()).toEqual([
			expect.objectContaining({
				id: "inspect-extension",
				label: "dgk wallet --json",
				intent: "extension:inspect",
				payload: expect.objectContaining({
					command: "dgk wallet --json",
					primary: true,
				}),
			}),
		]);
	});

	it("builds several primary surface actions from verb declarations", () => {
		const host = defineCapabilityHost({
			id: "examples/devbench-t1",
			command: "dgk",
			description: "Digital Gardening Kit - extension bench",
			capabilities: {
				deps: deps(),
				extensions: [showVerb],
			},
			operatorStatus: {
				primaryVerb: {
					name: "wallet",
					subject: "Extension bench",
					actionId: "inspect-extension",
					intent: "extension:inspect",
				},
				primaryVerbs: [
					{
						name: "agent-code",
						subject: "Coding agent",
						actionId: "run-agent-code",
						intent: "agent:code",
					},
					{
						name: "agent-review",
						subject: "Coding agent",
						actionId: "run-agent-review",
						intent: "agent:review",
					},
				],
			},
		});

		expect(host.baseModel().nextCommands).toEqual([
			"dgk wallet --json",
			"dgk agent-code --json",
			"dgk agent-review --json",
		]);
		expect(host.surfaceActions().map((action) => ({
			id: action.id,
			intent: action.intent,
			command: action.payload.command,
		}))).toEqual([
			{
				id: "inspect-extension",
				intent: "extension:inspect",
				command: "dgk wallet --json",
			},
			{
				id: "run-agent-code",
				intent: "agent:code",
				command: "dgk agent-code --json",
			},
			{
				id: "run-agent-review",
				intent: "agent:review",
				command: "dgk agent-review --json",
			},
		]);
	});
});

describe("capability host CLI helpers", () => {
	it("detects direct and bin-shimmed CLI entrypoints", () => {
		expect(isCapabilityHostCliEntrypoint("file:///repo/examples/wallet-t2/dist/cli.js", {
			argv: ["node", "/repo/examples/wallet-t2/dist/cli.js"],
			compiledFileName: "cli.js",
		})).toBe(true);

		expect(isCapabilityHostCliEntrypoint("file:///repo/examples/wallet-t2/dist/cli.js", {
			argv: ["node", "/repo/node_modules/.bin/dgk"],
			compiledFileName: "cli.js",
		})).toBe(true);

		expect(isCapabilityHostCliEntrypoint("file:///repo/examples/wallet-t2/src/cli.ts", {
			argv: ["node", "/repo/examples/wallet-t2/dist/cli.js"],
			compiledFileName: "cli.js",
		})).toBe(false);
	});

	it("runs parseAsync only for direct CLI entrypoints and captures failures", async () => {
		const parseAsync = vi.fn(async () => undefined);
		const argv = ["node", "/repo/examples/wallet-t2/dist/cli.js"];

		expect(await runCapabilityHostCli("file:///repo/examples/wallet-t2/src/cli.ts", () => ({
			parseAsync,
		}), {
			argv,
			compiledFileName: "cli.js",
		})).toBe(false);
		expect(parseAsync).not.toHaveBeenCalled();

		expect(await runCapabilityHostCli("file:///repo/examples/wallet-t2/dist/cli.js", () => ({
			parseAsync,
		}), {
			argv,
			compiledFileName: "cli.js",
		})).toBe(true);
		expect(parseAsync).toHaveBeenCalledWith(argv);

		const error = new Error("boom");
		const failingParse = vi.fn(async () => {
			throw error;
		});
		const processState: { exitCode?: number } = {};
		const consoleError = vi.fn();

		expect(await runCapabilityHostCli("file:///repo/examples/wallet-t2/dist/cli.js", () => ({
			parseAsync: failingParse,
		}), {
			argv,
			compiledFileName: "cli.js",
			consoleError,
			process: processState,
		})).toBe(true);
		expect(consoleError).toHaveBeenCalledWith(error);
		expect(processState.exitCode).toBe(1);
	});
});
