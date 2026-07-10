import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import {
	loadThemesFromPluginsDir,
	type DiscoverThemesResult,
} from "@refarm.dev/plugin-surface-loader/node";

import { pluginsBaseDir } from "../utils/refarm-home.js";

/**
 * The `theme` command as a multi-surface CapabilityGroup — the host seam that
 * finally wires the (previously orphaned) theme loader: a plugin that declares an
 * asset-layer theme-pack surface now surfaces on `theme list`, the REPL `/theme`
 * slash, the TUI menu, and to the agent from ONE declaration. A theme is inert
 * token DATA (no run(), no behavior), so this is a SAFE plugin-contribution front
 * — discovering + listing a plugin's theme never executes plugin code.
 *
 * This slice makes plugin themes VISIBLE + resolvable (list/show). Actually
 * PAINTING a surface with a theme (the CSS/TUI projection) is a downstream step
 * that lives with the renderers, not here.
 *
 * `deps.discover` is injected (defaults to scanning `<refarm-home>/plugins`) so
 * run() stays testable and never touches the filesystem directly.
 */
export interface ThemeCommandDeps {
	/** Discover installed plugin theme-packs. Defaults to the refarm plugins dir. */
	discover: () => DiscoverThemesResult;
}

export function defaultThemeDeps(): ThemeCommandDeps {
	return {
		discover: () => loadThemesFromPluginsDir(pluginsBaseDir()),
	};
}

/** Project a discovered/registered theme for output — the addressable summary a
 * surface renders (id + origin + token count), never the raw token map. */
function projectTheme(
	entry: { id: string; source: "built-in" | "plugin"; tokenCount: number },
) {
	return {
		id: entry.id,
		source: entry.source,
		tokenCount: entry.tokenCount,
	};
}

export function createThemeCapabilityGroup(
	deps: ThemeCommandDeps = defaultThemeDeps(),
): CapabilityGroup {
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List theme-packs contributed by installed plugins",
		run() {
			const { themes, registry, rejected } = deps.discover();
			const projected = themes.map((t) => {
				const registered = registry.get(t.id);
				return {
					...projectTheme({
						id: t.id,
						source: registered?.source ?? "plugin",
						tokenCount: registered
							? Object.keys(registered.theme).length
							: 0,
					}),
					pluginId: t.pluginId,
				};
			});
			return buildJsonSuccessEnvelope({
				command: "theme",
				operation: "list",
				extra: {
					themes: projected,
					rejected,
					count: projected.length,
				},
			});
		},
	};

	const show: CapabilityDescriptor = {
		name: "show",
		summary: "Show one plugin-contributed theme by id",
		args: [{ name: "id", required: true }],
		run(input) {
			const id = input.args.id as string;
			const { registry } = deps.discover();
			const registered = registry.get(id);
			if (!registered) {
				return buildJsonErrorEnvelope({
					command: "theme",
					operation: "show",
					error: "theme-not-found",
					message: `No theme matches "${id}".`,
					nextAction: "Run `theme list` to see plugin-contributed themes.",
				});
			}
			return buildJsonSuccessEnvelope({
				command: "theme",
				operation: "show",
				extra: {
					theme: {
						id: registered.id,
						source: registered.source,
						tokens: registered.theme,
					},
				},
			});
		},
	};

	return {
		name: "theme",
		summary: "Inspect theme-packs contributed by installed plugins",
		actions: { list, show },
		defaultAction: "list",
		transports: {
			cli: {},
			repl: { slashAliases: ["themes"] },
			http: { method: "GET", path: "/themes" },
		},
		renderers: { tui: { section: "appearance" } },
	};
}
