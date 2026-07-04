import { findPluginDirs } from "@refarm.dev/plugin-surface-loader/node";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pluginsBaseDir } from "../utils/refarm-home.js";

/**
 * The CLI-side `provides` preflight for `task run`: before an Effort is submitted
 * to the runtime, check whether the requested `<plugin> <fn>` target is actually
 * advertised by an installed plugin manifest's `capabilities.provides` (the
 * `<pluginKey>:<fn>` list, e.g. `agent:respond`). Today an unadvertised target is
 * accepted silently and only fails at runtime ("Plugin not loaded"); this surfaces
 * the mismatch at submit time.
 *
 * Permissive by FORM, not a gate: a missing `provides` returns a WARNING, not a
 * block — an operator may legitimately pre-submit against a plugin they are about
 * to install. The host decides whether to warn-and-queue (the default) or refuse.
 */

/** The set of `<pluginKey>:<fn>` capabilities advertised by installed plugins. */
export type ProvidesDiscovery = () => ReadonlySet<string>;

/** Read the `capabilities.provides` of every installed plugin under the plugins
 * dir into one set. Only the `provides` list is read — NOT the full manifest
 * validation — because a plugin advertises what it PROVIDES even when its `entry`
 * is a not-yet-installed template (the bundled agent manifest ships this way).
 * An unreadable/malformed plugin.json is skipped, never thrown: the preflight is
 * advisory, so one bad plugin must not block a submit. */
export function discoverInstalledProvides(
	pluginsDir: string = pluginsBaseDir(),
): ReadonlySet<string> {
	const provides = new Set<string>();
	for (const pluginDir of findPluginDirs(pluginsDir)) {
		try {
			const raw = readFileSync(join(pluginDir, "plugin.json"), "utf-8");
			const parsed = JSON.parse(raw) as {
				capabilities?: { provides?: unknown };
			};
			const list = parsed.capabilities?.provides;
			if (Array.isArray(list)) {
				for (const capability of list) {
					if (typeof capability === "string") provides.add(capability);
				}
			}
		} catch {
			// An unreadable plugin.json contributes nothing to the advisory set.
		}
	}
	return provides;
}

/** The advisory outcome of a task-run preflight. */
export interface TaskProvidesPreflight {
	/** The `<pluginKey>:<fn>` target the run resolves to. */
	target: string;
	/** True when an installed plugin advertises the target in its `provides`. */
	provided: boolean;
}

/**
 * Check whether `<plugin> <fn>` resolves to a capability an installed plugin
 * advertises. `plugin` is the short key the operator typed (e.g. `agent`), so the
 * target is `<plugin>:<fn>` — matched against the discovered provides set.
 */
export function checkTaskProvides(
	plugin: string,
	fn: string,
	discover: ProvidesDiscovery = discoverInstalledProvides,
): TaskProvidesPreflight {
	const target = `${plugin}:${fn}`;
	return { target, provided: discover().has(target) };
}
