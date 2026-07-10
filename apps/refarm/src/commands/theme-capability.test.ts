import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/capabilities";
import { REQUIRED_TOKENS, ThemeRegistry, type DsTheme } from "@refarm.dev/ds";
import type { DiscoverThemesResult } from "@refarm.dev/plugin-surface-loader/node";
import { describe, expect, it } from "vitest";

import {
	createThemeCapabilityGroup,
	type ThemeCommandDeps,
} from "./theme-capability.js";

/** A conformant DsTheme (every required token present) for the fixture registry. */
function completeTheme(): DsTheme {
	return Object.fromEntries(
		REQUIRED_TOKENS.map((t) => [t, "#101010"]),
	) as DsTheme;
}

/** A discover result with one plugin theme registered, mirroring the fs host. */
function discoverWithMidnight(): DiscoverThemesResult {
	const registry = new ThemeRegistry();
	registry.register("midnight", completeTheme(), "plugin");
	return {
		themes: [
			{ id: "midnight", pluginId: "@demo/theme-plugin", pluginDir: "/plugins/demo" },
		],
		registry,
		rejected: [],
	};
}

function deps(
	discover: () => DiscoverThemesResult = discoverWithMidnight,
): ThemeCommandDeps {
	return { discover };
}

describe("theme CapabilityGroup", () => {
	it("is a group with list + show, a read-only list default, and multi-surface hints", () => {
		const group = createThemeCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual(["list", "show"]);
		expect(group.defaultAction).toBe("list");
		// The projection buckets: REPL alias, HTTP route, TUI section.
		expect(group.transports?.repl?.slashAliases).toContain("themes");
		expect(group.transports?.http).toEqual({ method: "GET", path: "/themes" });
		expect(group.renderers?.tui?.section).toBe("appearance");
	});

	it("`list` surfaces a plugin-contributed theme with its origin + token count", async () => {
		const group = createThemeCapabilityGroup(deps());
		const resolved = resolveGroupAction(group, ["list"]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			count: number;
			themes: {
				id: string;
				source: string;
				pluginId: string;
				tokenCount: number;
			}[];
		};
		expect(env.count).toBe(1);
		expect(env.themes[0]).toMatchObject({
			id: "midnight",
			source: "plugin",
			pluginId: "@demo/theme-plugin",
			tokenCount: REQUIRED_TOKENS.length,
		});
	});

	it("`show <id>` resolves the plugin theme's tokens; unknown → error envelope", async () => {
		const group = createThemeCapabilityGroup(deps());

		const ok = resolveGroupAction(group, ["show", "midnight"]);
		const found = (await ok!.action.run(ok!.input)) as unknown as {
			ok: boolean;
			theme?: { id: string; source: string; tokens: Record<string, string> };
		};
		expect(found.ok).toBe(true);
		expect(found.theme?.id).toBe("midnight");
		expect(found.theme?.source).toBe("plugin");
		expect(Object.keys(found.theme!.tokens)).toHaveLength(REQUIRED_TOKENS.length);

		const missing = resolveGroupAction(group, ["show", "nope"]);
		const err = await missing!.action.run(missing!.input);
		expect(err.ok).toBe(false);
		expect((err as { error?: string }).error).toBe("theme-not-found");
	});

	it("surfaces a rejected (non-conformant) plugin theme without crashing the list", async () => {
		const group = createThemeCapabilityGroup(
			deps(() => ({
				themes: [],
				registry: new ThemeRegistry(),
				rejected: [
					{
						pluginId: "@bad/plugin",
						pluginDir: "/plugins/bad",
						id: "broken",
						issues: ['theme "broken" is missing tokens: primary'],
					},
				],
			})),
		);
		const resolved = resolveGroupAction(group, ["list"]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			count: number;
			rejected: { id?: string }[];
		};
		expect(env.ok).toBe(true);
		expect(env.count).toBe(0);
		expect(env.rejected[0]?.id).toBe("broken");
	});
});
