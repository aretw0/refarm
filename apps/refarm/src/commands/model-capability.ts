import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";

import {
	buildCurrentModelEnvelope,
	buildKnownModelProvidersEnvelope,
	buildModelDoctorEnvelope,
	defaultModelDeps,
	type ModelCommandDeps,
} from "./model.js";

/**
 * The `model` command as a multi-surface CapabilityGroup. Declared ONCE; the CLI
 * group projector, the REPL /model dispatcher, and a future API/web projector
 * all derive from this. Each sub-action's run() delegates to the existing pure
 * envelope builders — same behavior on every surface.
 *
 * SCOPE (this slice): the READ-ONLY actions only (current/providers/doctor),
 * whose logic already returns a pure status. The MUTATORS (set/reset/fallback/
 * base-url/env) are NOT here yet: each interleaves ~7-13 error/exit-code/print
 * points that must first be refactored to return an error envelope instead of
 * writing process.exitCode — a dedicated follow-up slice. Until all actions
 * exist, this group does NOT replace the legacy `modelCommand`; it proves the
 * read-only projection and is the seam the mutators plug into next.
 *
 * `deps` (loadTokens/fetch) are injected so run() never reads process.env or
 * globalThis.fetch directly.
 */
export function createModelCapabilityGroup(
	deps: ModelCommandDeps = defaultModelDeps(),
): CapabilityGroup {
	const current: CapabilityDescriptor = {
		name: "current",
		summary: "Show the currently configured model route",
		async run() {
			const tokens = await deps.loadTokens();
			return buildCurrentModelEnvelope(tokens);
		},
		renderers: { web: { route: "/settings/model" } },
	};

	const providers: CapabilityDescriptor = {
		name: "providers",
		summary: "List the built-in known model provider defaults",
		run() {
			return buildKnownModelProvidersEnvelope();
		},
	};

	const doctor: CapabilityDescriptor = {
		name: "doctor",
		summary: "Probe the active local model provider endpoint",
		async run() {
			const tokens = await deps.loadTokens();
			return buildModelDoctorEnvelope(tokens, {
				fetch: deps.fetch,
				isContainer: deps.isContainer,
			});
		},
	};

	return {
		name: "model",
		summary: "Inspect and change the active model route",
		actions: { current, providers, doctor },
		// Bare `model` / `/model` reads the current route (read-only default).
		defaultAction: "current",
		// Surface hints populated as the design's evidence that one declaration
		// carries CLI + REPL + API + TUI. The REPL/API projectors bind these once
		// the full action set (with mutators) replaces the legacy modelCommand.
		transports: {
			cli: {},
			http: { method: "POST", path: "/model" },
		},
		renderers: { tui: { section: "settings", shortcut: "ctrl+m" } },
	};
}
