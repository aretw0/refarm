import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import {
	createVaultCapabilityGroup,
	type VaultCommandDeps,
} from "./vault-capability.js";
import type { VaultDiscoveryResult } from "./vault-discovery.js";

function discoverWithExtractor(): VaultDiscoveryResult {
	return {
		providers: [
			{
				pluginId: "@demo/vault-extract",
				pluginKey: "vault",
				verbs: ["search", "extract"],
				targets: ["vault:search", "vault:extract"],
			},
		],
		rejected: [],
	};
}

/** Captures the submitted effort so a dispatch test can assert on it. */
function makeDeps(
	discover: () => VaultDiscoveryResult = discoverWithExtractor,
): VaultCommandDeps & { submitted: import("@refarm.dev/effort-contract-v1").Effort[] } {
	const submitted: import("@refarm.dev/effort-contract-v1").Effort[] = [];
	let counter = 0;
	return {
		discover,
		submitEffort: async (effort) => {
			submitted.push(effort);
			return effort.id;
		},
		newId: () => `id-${++counter}`,
		submitted,
	};
}

function deps(
	discover: () => VaultDiscoveryResult = discoverWithExtractor,
): VaultCommandDeps {
	return makeDeps(discover);
}

describe("vault CapabilityGroup", () => {
	it("projects onto every surface bucket (REPL alias, HTTP route, TUI section)", () => {
		const group = createVaultCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual([
			"dispatch",
			"list",
			"show",
		]);
		expect(group.defaultAction).toBe("list");
		expect(group.transports?.repl?.slashAliases).toContain("vaults");
		expect(group.transports?.http).toEqual({ method: "GET", path: "/vault" });
		expect(group.renderers?.tui?.section).toBe("extensions");
	});

	it("`list` surfaces a plugin-contributed vault provider with its verbs", async () => {
		const group = createVaultCapabilityGroup(deps());
		const resolved = resolveGroupAction(group, ["list"]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			count: number;
			providers: { pluginId: string; pluginKey: string; verbs: string[] }[];
		};
		expect(env.count).toBe(1);
		expect(env.providers[0]).toMatchObject({
			pluginId: "@demo/vault-extract",
			pluginKey: "vault",
			verbs: ["search", "extract"],
		});
	});

	it("`show <id>` resolves the provider's verbs+targets; unknown → error envelope", async () => {
		const group = createVaultCapabilityGroup(deps());

		const ok = resolveGroupAction(group, ["show", "@demo/vault-extract"]);
		const found = (await ok!.action.run(ok!.input)) as unknown as {
			ok: boolean;
			provider?: { pluginId: string; verbs: string[]; targets: string[] };
		};
		expect(found.ok).toBe(true);
		expect(found.provider?.pluginId).toBe("@demo/vault-extract");
		expect(found.provider?.targets).toEqual(["vault:search", "vault:extract"]);

		const missing = resolveGroupAction(group, ["show", "nope"]);
		const err = await missing!.action.run(missing!.input);
		expect(err.ok).toBe(false);
		expect((err as { error?: string }).error).toBe("vault-provider-not-found");
	});

	it("surfaces a rejected (unreadable) plugin without crashing the list", async () => {
		const group = createVaultCapabilityGroup(
			deps(() => ({ providers: [], rejected: ["@bad/plugin"] })),
		);
		const resolved = resolveGroupAction(group, ["list"]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			count: number;
			rejected: string[];
		};
		expect(env.ok).toBe(true);
		expect(env.count).toBe(0);
		expect(env.rejected).toEqual(["@bad/plugin"]);
	});

	it("`dispatch <verb> <note>` submits an effort whose fn is the verb + replyRef", async () => {
		const d = makeDeps();
		const group = createVaultCapabilityGroup(d);
		const resolved = resolveGroupAction(group, [
			"dispatch",
			"extract",
			"20-Projects/demanda-42.md",
		]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			effortId: string;
			verb: string;
			pluginId: string;
			replyRef: string;
		};
		expect(env.ok).toBe(true);
		expect(env.verb).toBe("extract");
		expect(env.pluginId).toBe("vault");
		// The submitted effort's task carries fn=verb and the replyRef for the
		// async dispatch-result correlation.
		expect(d.submitted).toHaveLength(1);
		const task = d.submitted[0]!.tasks[0]!;
		expect(task.pluginId).toBe("vault");
		expect(task.fn).toBe("extract");
		expect((task.args as { replyRef: string }).replyRef).toBe(env.effortId);
		expect((task.args as { note: { path: string } }).note.path).toBe(
			"20-Projects/demanda-42.md",
		);
	});

	it("`dispatch` returns an error envelope when the submit fails", async () => {
		const d = makeDeps();
		d.submitEffort = async () => {
			throw new Error("runtime HTTP 502");
		};
		const group = createVaultCapabilityGroup(d);
		const resolved = resolveGroupAction(group, ["dispatch", "search", "n.md"]);
		const err = await resolved!.action.run(resolved!.input);
		expect(err.ok).toBe(false);
		expect((err as { error?: string }).error).toBe("vault-dispatch-failed");
	});
});
