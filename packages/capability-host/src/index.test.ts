import {
	buildJsonSuccessEnvelope,
	createLocalVaultCommandDeps,
	defaultSourceDeps,
} from "@refarm.dev/capabilities-v1";
import { describe, expect, it, vi } from "vitest";

import {
	defineCapabilityApp,
	defineCapabilityHost,
	type CapabilityHost,
	type CapabilityHostDefinition,
} from "./index.js";

describe("@refarm.dev/capability-host public API", () => {
	it("exposes the white-label host boundary without importing capabilities-v1 host symbols", async () => {
		const definition = {
			id: "examples/public-api",
			command: "dgk",
			description: "Digital Gardening Kit",
			capabilities: {
				deps: {
					source: defaultSourceDeps(),
					vault: createLocalVaultCommandDeps(),
				},
				extensions: [
					{
						name: "open",
						summary: "Open the workbench",
						transports: { cli: {}, http: { method: "GET", path: "/open" } },
						renderers: { tui: { section: "workbench" } },
						run: () =>
							buildJsonSuccessEnvelope({
								command: "open",
								operation: "render",
								extra: { opened: true },
							}),
					},
				],
			},
			operatorStatus: {
				capabilityUnit: {
					subject: "Workbench",
					action: {
						id: "open-workbench",
						label: "dgk open --json",
						command: "dgk open --json",
						primary: true,
					},
				},
			},
			serve: false,
		} satisfies CapabilityHostDefinition;

		const host: CapabilityHost = defineCapabilityHost(definition);
		expect(host.program().name()).toBe("dgk");
		expect(host.registry().get("open")).toBeDefined();
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-workbench",
		]);
		expect(host.baseModel().nextCommands).toEqual(["dgk open --json"]);
	});

	it("builds app helpers around a white-label host declaration", async () => {
		const parseAsync = vi.fn(async () => undefined);
		const createHost = vi.fn((options: { statePath?: string } = {}) => ({
			registry: () => ({ statePath: options.statePath }),
			baseModel: () => ({ nextCommands: [options.statePath ?? "memory"] }),
			surfaceActions: () => [],
			surfaceActionRows: () => [],
			surfaceContext: () => ({
				hostId: "examples/public-api",
				data: { command: "dgk", description: "Digital Gardening Kit" },
				actions: [],
			}),
			program: () => ({ parseAsync }),
			serve: () => {
				throw new Error("not used");
			},
		}) as unknown as CapabilityHost);
		const app = defineCapabilityApp({
			host: createHost,
			programOptions: (options: { statePath?: string } = {}) => ({
				...options,
				statePath: options.statePath ?? "/tmp/dgk-state.json",
			}),
		});

		expect(app.registry()).toEqual({ statePath: undefined });
		expect(app.baseModel({ statePath: "/tmp/explicit.json" })).toEqual({
			nextCommands: ["/tmp/explicit.json"],
		});
		expect(app.program()).toEqual({ parseAsync });
		expect(createHost).toHaveBeenLastCalledWith({ statePath: "/tmp/dgk-state.json" });

		const argv = ["node", "/repo/examples/wallet-t2/dist/cli.js"];
		await expect(app.runCli("file:///repo/examples/wallet-t2/dist/cli.js", {
			argv,
			compiledFileName: "cli.js",
		})).resolves.toBe(true);
		expect(parseAsync).toHaveBeenCalledWith(argv);
	});

	it("applies app default options to every helper surface", () => {
		const createHost = vi.fn((options: { statePath?: string } = {}) => ({
			registry: () => ({ statePath: options.statePath }),
			baseModel: () => ({ nextCommands: [options.statePath ?? "memory"] }),
			surfaceActions: () => [{ id: options.statePath ?? "memory" }],
			surfaceActionRows: () => [],
			surfaceContext: () => ({
				hostId: "examples/public-api",
				data: { command: "dgk", description: "Digital Gardening Kit" },
				actions: [{ id: options.statePath ?? "memory" }],
			}),
			program: () => ({ parseAsync: vi.fn(async () => undefined) }),
			serve: () => {
				throw new Error("not used");
			},
		}) as unknown as CapabilityHost);
		const app = defineCapabilityApp({
			host: createHost,
			defaultOptions: () => ({ statePath: "/tmp/dgk-state.json" }),
		});

		expect(app.registry()).toEqual({ statePath: "/tmp/dgk-state.json" });
		expect(app.baseModel()).toEqual({ nextCommands: ["/tmp/dgk-state.json"] });
		expect(app.surfaceActions()).toEqual([{ id: "/tmp/dgk-state.json" }]);
		expect(app.surfaceContext().actions).toEqual([
			{ id: "/tmp/dgk-state.json" },
		]);
		expect(app.registry({ statePath: "/tmp/explicit.json" })).toEqual({
			statePath: "/tmp/explicit.json",
		});
	});
});
