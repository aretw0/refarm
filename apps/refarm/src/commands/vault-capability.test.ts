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

function deps(
	discover: () => VaultDiscoveryResult = discoverWithExtractor,
): VaultCommandDeps {
	return { discover };
}

describe("vault CapabilityGroup", () => {
	it("projects onto every surface bucket (REPL alias, HTTP route, TUI section)", () => {
		const group = createVaultCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual(["list", "show"]);
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
});
