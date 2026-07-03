import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import chalk from "chalk";

import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildCurrentModelEnvelope,
	buildKnownModelProvidersEnvelope,
	buildModelDoctorEnvelope,
	buildModelEnvEnvelope,
	buildResetScopedModelEnvelope,
	buildSetFallbackEnvelope,
	buildSetModelBaseUrlEnvelope,
	buildSetModelEnvelope,
	type CurrentModelStatus,
	defaultModelDeps,
	formatCurrentModelFromStatus,
	formatKnownModelProviders,
	formatModelDoctorFromStatus,
	formatModelEnvFromEnvelope,
	type ModelCommandDeps,
	type ModelDoctorStatus,
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
				name: "shell",
				kind: "boolean",
				summary: "Output POSIX shell export statements",
			},
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

/**
 * CLI/REPL text rendering per sub-action, formatting the same human output the
 * legacy modelCommand printed — from the envelope (which carries the status),
 * reusing the format* functions. Exit intent stays here (surface concern), never
 * in run(). An error envelope renders its message; the projector sets exitCode.
 */
export function modelCapabilityHooks(subVerb: string): CapabilitySurfaceHooks {
	const renderError = (envelope: { message?: string; error?: string }): string =>
		chalk.red(`✗  ${envelope.message ?? envelope.error ?? "model error"}`);

	switch (subVerb) {
		case "current":
			return {
				renderText: (envelope) =>
					formatCurrentModelFromStatus(
						envelope as unknown as CurrentModelStatus,
					),
			};
		case "providers":
			return { renderText: () => formatKnownModelProviders() };
		case "env":
			return {
				renderText: (envelope, input) =>
					formatModelEnvFromEnvelope(
						envelope as unknown as {
							env?: Record<string, string>;
							managedKeys?: string[];
						},
						{ shell: Boolean(input?.options.shell) },
					),
			};
		case "doctor":
			return {
				renderText: (envelope) =>
					formatModelDoctorFromStatus(
						envelope as unknown as ModelDoctorStatus,
					),
			};
		case "set":
		case "fallback":
		case "reset":
		case "base-url": {
			return {
				renderText: (envelope) => {
					if (envelope.ok === false) return renderError(envelope);
					const m = envelope as unknown as {
						action: string;
						ref?: string;
						baseUrl?: string;
						scope?: string;
					};
					switch (m.action) {
						case "set-route":
							return chalk.green(
								`✓  ${m.scope === "default" ? "Default model" : `${m.scope} model`} set: ${m.ref}`,
							);
						case "set-fallback":
							return chalk.green(`✓  Fallback model set: ${m.ref}`);
						case "disable-fallback":
							return chalk.green("✓  Fallback model disabled");
						case "set-base-url":
							return chalk.green(`✓  Model base URL set: ${m.baseUrl}`);
						case "disable-base-url":
							return chalk.green("✓  Model base URL disabled");
						case "reset-route":
							return chalk.green(
								`✓  ${m.scope} model reset to built-in default`,
							);
						default:
							return chalk.green("✓  model updated");
					}
				},
			};
		}
		default:
			return {};
	}
}
