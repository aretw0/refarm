import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";

import {
	buildCurrentModelEnvelope,
	buildKnownModelProvidersEnvelope,
	buildModelDoctorEnvelope,
	buildModelEnvEnvelope,
	buildResetScopedModelEnvelope,
	buildSetFallbackEnvelope,
	buildSetModelBaseUrlEnvelope,
	buildSetModelEnvelope,
	defaultModelDeps,
	type ModelCommandDeps,
} from "./model.js";
import { parseModelScope } from "../model-routing.js";

/**
 * The `model` command as a multi-surface CapabilityGroup. Declared ONCE; the CLI
 * group projector, the REPL /model dispatcher, and a future API/web projector
 * all derive from this. Each sub-action's run() delegates to the existing pure
 * envelope builders — same behavior on every surface.
 *
 * All 8 actions: read-only (current/providers/doctor/env) + mutators
 * (set/reset/fallback/base-url). Every run() is pure (returns an envelope,
 * success or error); exit intent lives in the surface hooks, never in run().
 * `deps` (loadTokens/saveTokens/fetch) are injected so run() never reads
 * process.env or globalThis.fetch directly.
 */
export function createModelCapabilityGroup(
	deps: ModelCommandDeps = defaultModelDeps(),
): CapabilityGroup {
	const current: CapabilityDescriptor = {
		name: "current",
		summary: "Show the currently configured model route",
		async run() {
			return buildCurrentModelEnvelope(await deps.loadTokens());
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
			return buildModelDoctorEnvelope(await deps.loadTokens(), {
				fetch: deps.fetch,
				isContainer: deps.isContainer,
			});
		},
	};

	const env: CapabilityDescriptor = {
		name: "env",
		summary: "Show the current model runtime environment exports",
		options: [
			{
				name: "include-secrets",
				kind: "boolean",
				summary: "Include local runtime credential secrets",
			},
		],
		async run(input) {
			return buildModelEnvEnvelope(await deps.loadTokens(), {
				includeSecrets: Boolean(input.options["include-secrets"]),
			});
		},
	};

	const set: CapabilityDescriptor = {
		name: "set",
		summary: "Set the model route (provider/model)",
		args: [{ name: "ref", required: true }],
		options: [
			{
				name: "scope",
				kind: "string",
				summary: "Route scope (default/worker/monitor)",
				defaultValue: "default",
			},
		],
		run(input) {
			const scope = parseModelScope(input.options.scope as string) ?? "default";
			return buildSetModelEnvelope(input.args.ref as string, scope, deps);
		},
	};

	const fallback: CapabilityDescriptor = {
		name: "fallback",
		summary: "Set or disable the persisted fallback model route",
		args: [{ name: "ref", required: true }],
		run(input) {
			return buildSetFallbackEnvelope(input.args.ref as string, deps);
		},
	};

	const reset: CapabilityDescriptor = {
		name: "reset",
		summary: "Reset a scoped model route to its built-in default",
		options: [
			{
				name: "scope",
				kind: "string",
				summary: "Route scope (default/worker/monitor)",
				defaultValue: "default",
			},
		],
		run(input) {
			const scope = parseModelScope(input.options.scope as string) ?? "default";
			return buildResetScopedModelEnvelope(scope, deps);
		},
	};

	const baseUrl: CapabilityDescriptor = {
		name: "base-url",
		summary: "Set or disable the persisted OpenAI-compatible base URL",
		args: [{ name: "url", required: true }],
		run(input) {
			return buildSetModelBaseUrlEnvelope(input.args.url as string, deps);
		},
	};

	return {
		name: "model",
		summary: "Inspect and change the active model route",
		actions: {
			current,
			providers,
			doctor,
			env,
			set,
			fallback,
			reset,
			"base-url": baseUrl,
		},
		// Bare `model` / `/model` reads the current route (read-only default).
		defaultAction: "current",
		transports: {
			cli: {},
			repl: { slashAliases: ["provider"] },
			http: { method: "POST", path: "/model" },
		},
		renderers: { tui: { section: "settings", shortcut: "ctrl+m" } },
	};
}
