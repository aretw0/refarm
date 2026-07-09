import {
	createMemorySubmitEffort,
	DEFAULT_HOST_COMMAND_ENV_KEY,
	type CapabilityEntry,
} from "@refarm.dev/capability-host";
import { createCapabilityTestHarness } from "@refarm.dev/capability-host/testing";
import { describe, expect, it } from "vitest";

import { buildDevbenchHost, buildRegistry, DGK_COMMAND } from "./cli.js";
import { NOTES_LOOKUP_API } from "./persona.js";

const harness = createCapabilityTestHarness();

/**
 * The T1 flow through devbench's own CLI registry — PROCESS mode. It proves the
 * developer's angle: a coding-agent EXTENSION declares itself and its verbs surface by
 * themselves (the machine visible), and an inspector shows the mechanism.
 */
describe("devbench T1 — the developer's extension bench (process mode)", () => {
	it("the coding-agent's verbs surface into the CLI from its manifest (no app run())", () => {
		const names = buildRegistry().list().map((e: CapabilityEntry) => e.name);
		// agent:code / agent:review -> `agent-code` / `agent-review`,
		// notes:search / notes:index -> `notes-search` / `notes-index`.
		expect(names).toEqual(expect.arrayContaining([
			"agent-code",
			"agent-review",
			"notes-search",
			"notes-index",
		]));
		// The neutral blocks are there too — the extension coexists with them.
		expect(names).toEqual(
			expect.arrayContaining(["source", "records", "vault", "extension", "status", "actions"]),
		);
	});

	it("declares dgk as the white-label host and exposes surface actions", () => {
		const host = buildDevbenchHost();
		expect(host.program().name()).toBe(DGK_COMMAND);
		expect(host.baseModel()).toMatchObject({
			command: DGK_COMMAND,
			operation: "base",
			nextCommand: `${DGK_COMMAND} extension --json`,
		});
		expect(host.surfaceActions()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "inspect-extension",
				intent: "extension:inspect",
				payload: expect.objectContaining({
					command: `${DGK_COMMAND} extension --json`,
				}),
			}),
			expect.objectContaining({
				id: "run-agent-code",
				intent: "agent:code",
				payload: expect.objectContaining({
					command: `${DGK_COMMAND} agent-code --json`,
				}),
			}),
			expect.objectContaining({
				id: "run-agent-review",
				intent: "agent:review",
				payload: expect.objectContaining({
					command: `${DGK_COMMAND} agent-review --json`,
				}),
			}),
		]));
	});

	it("supports overriding the host command for white-label consumers", () => {
		const command = "t1-white-label";
		const host = buildDevbenchHost({ command });
		expect(host.program().name()).toBe(command);
		expect(host.baseModel()).toMatchObject({
			command,
			operation: "base",
			nextCommand: `${command} extension --json`,
		});
		expect(host.surfaceActions()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "inspect-extension",
					payload: expect.objectContaining({
						command: `${command} extension --json`,
					}),
				}),
				expect.objectContaining({
					id: "run-agent-code",
					payload: expect.objectContaining({
						command: `${command} agent-code --json`,
					}),
				}),
				expect.objectContaining({
					id: "run-agent-review",
					payload: expect.objectContaining({
						command: `${command} agent-review --json`,
					}),
				}),
			]),
		);
	});

	it("supports overriding the host command from explicit environment for white-label consumers", () => {
		const command = "t1-white-label-env";
		const host = buildDevbenchHost({
			commandEnv: { [DEFAULT_HOST_COMMAND_ENV_KEY]: command },
		});
		expect(host.program().name()).toBe(command);
		expect(host.baseModel()).toMatchObject({
			command,
			operation: "base",
			nextCommand: `${command} extension --json`,
		});
	});

	it("uses injected manifests to drive extension introspection and primary actions", async () => {
		const customManifest = {
			id: "@devbench/custom-extension",
			capabilities: {
				provides: ["paper:scan"],
				subscribes: ["paper:dispatch"],
			},
		};

		const host = buildDevbenchHost({ manifests: [customManifest] });
		const reg = buildRegistry({ manifests: [customManifest] });
		expect(host.baseModel().nextCommand).toBe(`${DGK_COMMAND} extension --json`);
		expect(host.surfaceActions().map((action) => action.id)).toEqual(
			expect.arrayContaining([
				"run-paper-scan",
				"inspect-extension",
			]),
		);
		const names = reg.list().map((e: CapabilityEntry) => e.name);
		expect(names).toEqual(expect.arrayContaining(["paper-scan", "extension"]));

		const env = await harness.runVerb<{
			ok: boolean;
			pluginId: string;
			declared: string[];
			surfaced: Array<{ verb: string; summary?: string }>;
		}>(reg, "extension");
		expect(env.ok).toBe(true);
		expect(env.pluginId).toBe(customManifest.id);
		expect(env.declared).toEqual(["paper:scan"]);
		expect(env.surfaced).toEqual([{ verb: "paper-scan", summary: expect.any(String) }]);
	});

	it("makes the plugin-to-plugin recursion visible: the coding-agent requires an API the notes-indexer provides", async () => {
		// The T1 point: the coding-agent is itself a plugin, and it consumes another
		// plugin (the notes-indexer) through the host — extensions extending extensions.
		// The inspector surfaces both halves of that SPI pair AND resolves the link.
		const reg = buildRegistry();
		const env = await harness.runVerb<{
			ok: boolean;
			pluginId: string;
			providesApi: string[];
			requiresApi: string[];
			apiLinks: Array<{ api: string; requiredBy: string; providedBy: string | null }>;
		}>(reg, "extension");
		expect(env.ok).toBe(true);
		expect(env.pluginId).toBe("@devbench/coding-agent");
		// The coding-agent consumes the notes-indexer's API — the required half.
		expect(env.requiresApi).toEqual([NOTES_LOOKUP_API]);
		expect(env.providesApi).toEqual([]);
		// The resolved recursion: the requirement is met by the loaded notes-indexer.
		expect(env.apiLinks).toEqual([
			{
				api: NOTES_LOOKUP_API,
				requiredBy: "@devbench/coding-agent",
				providedBy: "@devbench/notes-indexer",
			},
		]);
	});

	it("surfaces extension and plugin verbs on web endpoints", async () => {
		const host = buildDevbenchHost({ submitEffort: createMemorySubmitEffort() });
		const entries = host.registry().list();
		const extensionEntry = entries.find((entry) => entry.name === "extension");
		const agentCodeEntry = entries.find((entry) => entry.name === "agent-code");
		const agentReviewEntry = entries.find((entry) => entry.name === "agent-review");
		const notesSearchEntry = entries.find((entry) => entry.name === "notes-search");
		const notesIndexEntry = entries.find((entry) => entry.name === "notes-index");
		expect(extensionEntry).toMatchObject({
			renderers: {
				web: { route: "/extension", icon: "extension" },
			},
			transports: {
				http: { path: "/ext/inspect" },
			},
		});
		expect(agentCodeEntry).toMatchObject({
			renderers: {
				web: { route: "/agent-code" },
				tui: { section: "agent" },
			},
			transports: {
				http: { path: "/agent-code" },
			},
		});
		expect(agentReviewEntry).toMatchObject({
			renderers: {
				web: { route: "/agent-review" },
				tui: { section: "agent" },
			},
			transports: {
				http: { path: "/agent-review" },
			},
		});
		expect(notesSearchEntry).toMatchObject({
			renderers: {
				web: { route: "/notes-search" },
				tui: { section: "notes" },
			},
			transports: {
				http: { path: "/notes-search" },
			},
		});
		expect(notesIndexEntry).toMatchObject({
			renderers: {
				web: { route: "/notes-index" },
				tui: { section: "notes" },
			},
			transports: {
				http: { path: "/notes-index" },
			},
		});

		const { listening, close } = host.serve({ port: 0 });
		try {
			const { port } = await listening;
			const extensionResponse = await fetch(`http://127.0.0.1:${port}/capabilities/ext/inspect`);
			expect(extensionResponse.status).toBe(200);
			const extensionBody = (await extensionResponse.json()) as {
				ok: boolean;
				pluginId?: string;
			};
			expect(extensionBody.ok).toBe(true);
			expect(extensionBody.pluginId).toBe("@devbench/coding-agent");

			const codeResponse = await fetch(`http://127.0.0.1:${port}/capabilities/agent-code`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ args: {} }),
			});
			expect(codeResponse.status).toBe(200);
			const codeBody = (await codeResponse.json()) as {
				ok: boolean;
				command: string;
				effortId?: string;
			};
			expect(codeBody.ok).toBe(true);
			expect(codeBody.command).toBe("agent-code");
			expect(codeBody.effortId).toBeTruthy();

			const specResponse = await fetch(`http://127.0.0.1:${port}/docs/openapi.json`);
			expect(specResponse.status).toBe(200);
			const spec = (await specResponse.json()) as { paths: Record<string, unknown> };
			expect(Object.keys(spec.paths)).toContain("/capabilities/ext/inspect");
			expect(Object.keys(spec.paths)).toContain("/capabilities/agent-code");
			expect(Object.keys(spec.paths)).toContain("/capabilities/agent-review");
			expect(Object.keys(spec.paths)).toContain("/capabilities/notes-search");
			expect(Object.keys(spec.paths)).toContain("/capabilities/notes-index");
		} finally {
			await close();
		}
	});

	it("extension exposes the mechanism: declaration → surfaced verbs", async () => {
		const env = await harness.runVerb(buildRegistry(), "extension");
		expect(env.ok).toBe(true);
		expect(env.declared).toEqual(["agent:code", "agent:review"]);
		const surfaced = (env.surfaced as Array<{ verb: string }>).map((s) => s.verb).sort();
		expect(surfaced).toEqual(["agent-code", "agent-review"]);
	});

	it("multiple manifests dispatch to plugin dispatch with valid task envelopes", async () => {
		const submitEffort = createMemorySubmitEffort();
		const env = await harness.runVerb<{
			ok: boolean;
			command: string;
			verb: string;
			effortId: string;
			replyRef: string;
		}>(
			buildRegistry({ submitEffort }),
			"notes-search",
			{
				args: { args: ['query="security"', "limit=3"] },
				options: {},
				json: true,
			},
		);
		expect(env.ok).toBe(true);
		expect(env.command).toBe("notes-search");
		expect(env.verb).toBe("search");
		expect(env.effortId).toBeTruthy();
		expect(env.replyRef).toBe(env.effortId);

		const effort = submitEffort.submitted.at(-1);
		expect(effort).toBeDefined();
		expect(effort?.tasks).toHaveLength(1);
		expect(effort?.tasks[0]).toMatchObject({
			pluginId: "notes",
			fn: "search",
			args: { query: "security", limit: 3, replyRef: expect.any(String) },
		});
	});

	it("a surfaced agent verb dispatches across the bridge (two-phase receipt)", async () => {
		const env = await harness.runVerb<{ ok: boolean; verb: string; effortId: string; replyRef: string }>(
			buildRegistry({ submitEffort: createMemorySubmitEffort() }),
			"agent-code",
			{
				args: { args: ['prompt="add a test"'] },
				options: {},
				json: true,
			},
		);
		expect(env.ok).toBe(true);
		expect(env.verb).toBe("code");
		expect(env.replyRef).toBe(env.effortId);
	});

	it("degrades with an actionable error when the runtime is not reachable", async () => {
		// The exact shape undici throws when the sidecar daemon isn't up — a
		// white-label app must classify this as "runtime offline", not a raw fetch error.
		const env = await harness.runVerb<{
			ok: boolean;
			error: string;
			message: string;
			nextAction: string;
		}>(
			buildRegistry({
				submitEffort: async () => {
					const err = new TypeError("fetch failed");
					(err as { cause?: unknown }).cause = Object.assign(
						new Error("connect ECONNREFUSED 127.0.0.1:42123"),
						{ code: "ECONNREFUSED" },
					);
					throw err;
				},
			}),
			"agent-code",
			{
				args: { args: ['prompt="fix this bug"'] },
				options: {},
				json: true,
			},
		);
		expect(env.ok).toBe(false);
		expect(env.error).toBe("runtime-unreachable");
		expect(env.message).toContain("The runtime is not reachable");
		expect(env.nextAction).toMatch(/start the runtime/i);
	});
});
