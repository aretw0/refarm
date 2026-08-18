import type {
	CapabilityDescriptor,
	CapabilityGroup,
	CapabilityGroupResolution,
} from "@refarm.dev/capabilities";
import type { AccountView } from "@refarm.dev/model-account-contract-v1";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { REFARM_BINARY } from "../brand.js";

import {
	authorizedAccounts,
	readModelAuthorization,
	type ModelAuthorization,
} from "@refarm.dev/model-account-contract-v1";
import fs from "node:fs";
import path from "node:path";
import {
	loadAccountCredentials,
	loadAccountView,
	type AccountViewSilo,
} from "../credentials/account-view-loader.js";
import { renewExpiredCopilotCredentials } from "../credentials/copilot-renew.js";
import { githubOAuthClientId } from "../credentials/github.js";
import {
	copilotRequestIdentity,
	resolveCopilotIdentity,
} from "../credentials/oauth/index.js";
import { parseModelScope } from "../model-routing.js";
import { resolveRefarmVersion } from "./runtime-metadata.js";

import { resolveRefarmHome } from "../utils/refarm-home.js";
import { renderCapabilityError, type CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildCurrentModelEnvelope,
	buildInvalidScopeEnvelope,
	buildKnownModelProvidersEnvelope,
	buildModelDoctorEnvelope,
	buildModelEnvEnvelope,
	buildResetScopedModelEnvelope,
	buildSetFallbackEnvelope,
	buildSetModelBaseUrlEnvelope,
	buildSetModelEnvelope,
	defaultModelDeps,
	formatCurrentModelFromStatus,
	formatKnownModelProviders,
	formatModelDoctorFromStatus,
	formatModelEnvFromEnvelope,
	type CurrentModelStatus,
	type ModelCommandDeps,
	type ModelDoctorStatus,
} from "./model.js";

/**
 * The rich `model` token grammar, as a pure token→resolution mapping the group's
 * surface-neutral `resolve` exposes. It reproduces exactly what the legacy
 * `parseModelCommand` accepted, so the slash form keeps its ergonomics after the
 * group migration (and any future surface handing raw tokens gets it for free):
 *   /model                     → current
 *   /model providers           → providers
 *   /model set [--scope s] ref → set
 *   /model fallback ref        → fallback
 *   /model reset [s]|--scope s → reset (default scope rejected → set fallthrough)
 *   /model base-url url        → base-url
 *   /model <scope> ref         → set --scope <scope> ref   (scope-first sugar)
 *   /model <ref>               → set default <ref>          (bare-ref sugar)
 * Returns null for the known sub-verbs the generic dispatcher already handles
 * (env, doctor) and for the explicit-sub forms above once matched by key, so
 * `resolveGroupAction` parses the child's own flags. Pure; unit-testable.
 */
export function resolveModelGrammar(tokens: string[]): CapabilityGroupResolution | null {
	const clean = tokens.filter(Boolean);
	const [firstRaw, ...rest] = clean;
	const first = firstRaw?.toLowerCase();

	// Bare `/model` reads the current route.
	if (!first) return { key: "current", tokens: [] };

	// `reset` accepts a BARE positional scope (`/model reset worker`) as well as
	// `--scope worker`; its descriptor only declares a `--scope` option, so a bare
	// scope token would be dropped. Normalize a leading bare scope to `--scope`.
	if (first === "reset") {
		const [maybeScope, ...tail] = rest.filter(Boolean);
		if (maybeScope && maybeScope !== "--scope" && parseModelScope(maybeScope)) {
			return { key: "reset", tokens: ["--scope", maybeScope, ...tail] };
		}
		return { key: "reset", tokens: rest };
	}

	// Other explicit sub-verbs pass straight through with their remaining tokens,
	// so the child's own arg/option specs parse them (e.g. `set --scope worker ref`).
	if (
		first === "current" ||
		first === "providers" ||
		first === "set" ||
		first === "fallback" ||
		first === "base-url" ||
		first === "env" ||
		first === "doctor"
	) {
		return { key: first, tokens: rest };
	}

	// Scope-first sugar: `/model worker <ref>` → `set --scope worker <ref>`.
	const directScope = parseModelScope(first);
	if (directScope) {
		const ref = rest.join(" ").trim();
		if (!ref) return null; // no ref → let the generic default show current
		return { key: "set", tokens: ["--scope", directScope, ref] };
	}

	// Bare-ref sugar: `/model openai/gpt-5` → `set default openai/gpt-5`.
	return { key: "set", tokens: [clean.join(" ").trim()] };
}

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
			{
				name: "workspace",
				kind: "string",
				summary: "Resolve the credential as this workspace would — honours `refarm credential bind`",
			},
		],
		async run(input) {
			// THE VIEW IS BUILT HERE, where I/O is allowed, and handed to a pure builder. It is what
			// lets the envelope say WHY a credential is absent instead of omitting it in silence —
			// measured 2026-08-15 with two eligible Copilot accounts.
			//
			// A view that cannot be loaded is left undefined rather than guessed at: the entries are
			// still correct, and the notice simply has nothing to add.
			let view: AccountView | undefined;
			try {
				// THE WORKSPACE IS WHAT MAKES A BINDING MEAN ANYTHING. Without it the view resolves at
				// node level and two eligible accounts stay ambiguous forever, however carefully the
				// operator bound them.
				const workspaceId =
					typeof input.options.workspace === "string" && input.options.workspace.trim()
						? input.options.workspace.trim()
						: null;
				view = await loadAccountView({
					// The DECLARED home (ISS-139). `process.env.HOME` here read a catalog that is not
					// there, so `model env --include-secrets` exported no credential at all — and
					// `scripts/tractor-start.sh` refuses to start the runtime without one.
					home: resolveRefarmHome(),
					silo: new SiloCore() as unknown as AccountViewSilo,
					workspaceId,
				});
			} catch {
				view = undefined;
			}
			// The DECLARATION and the credentials it authorises, loaded only for `--include-secrets`.
			// A node that has declared nothing gets exactly the previous behaviour.
			// THE DECLARATION IS CONFIG, NOT A SECRET, so it is read on every call: it decides
			// `MODEL_CONFIGURED_PROVIDERS`, which is the host's egress allowlist and is exported
			// with or without `--include-secrets`. The CREDENTIALS behind it are loaded only when
			// secrets were asked for.
			let authorization: ModelAuthorization | undefined;
			let credentials: ReadonlyMap<string, unknown> | undefined;
			const home = resolveRefarmHome();
			try {
				authorization = readModelAuthorization(
					JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as unknown,
				);
			} catch {
				authorization = undefined;
			}
			if (input.options["include-secrets"]) {
				try {
					const silo = new SiloCore() as unknown as AccountViewSilo & {
						saveSecret?: (ns: string, id: string, value: string) => Promise<unknown>;
					};
					credentials = await loadAccountCredentials({ home, silo });
					// RENEWED BEFORE THE RUNTIME IS HANDED IT (ISS-141). A Copilot token lasts
					// minutes and `scripts/tractor-start.sh` provisions the Rust runtime from exactly
					// this command, so an expired credential here starts a runtime that cannot
					// dispatch and says nothing until the first request fails.
					if (authorization && view && typeof silo.saveSecret === "function") {
						// EVERY AUTHORISED SEAT, not only the provisionable one (ISS-145). This
						// iterated `provisionableAccounts`, which REFUSES a provider holding two
						// authorised seats — so the moment the operator authorised both of his
						// Copilot accounts, neither was renewed and both silently expired. A
						// renewal that skips exactly the accounts the node may spend is a renewal
						// that runs only where it was not needed.
						const provision = authorizedAccounts(authorization, view.accounts).authorized;
						// THE DECLARED IDENTITY, resolved from the same config the login reads. Inventing
						// headers here refuses on every attempt (ISS-141).
						const identity = copilotRequestIdentity(
							resolveCopilotIdentity(
								JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as unknown,
							),
							githubOAuthClientId(),
							// THE BRAND IS THE APP'S. The wire package takes a user agent and never builds one, so it
		// stays usable by any caller (brand guard).
		`${REFARM_BINARY}/${resolveRefarmVersion()}`,
						);
						credentials = await renewExpiredCopilotCredentials(provision, credentials, {
							fetch: globalThis.fetch,
							identityHeaders: identity.headers,
							save: async (credentialId, credential) => {
								await silo.saveSecret!("model", credentialId, JSON.stringify(credential));
							},
						});
					}
				} catch {
					credentials = undefined;
				}
			}
			return buildModelEnvEnvelope(await deps.loadTokens(), {
				includeSecrets: Boolean(input.options["include-secrets"]),
				...(view ? { view } : {}),
				...(authorization ? { authorization } : {}),
				...(credentials ? { credentials } : {}),
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
			const raw = input.options.scope as string | undefined;
			const invalid = buildInvalidScopeEnvelope(raw);
			if (invalid) return invalid;
			const scope = parseModelScope(raw) ?? "default";
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
			const raw = input.options.scope as string | undefined;
			const invalid = buildInvalidScopeEnvelope(raw);
			if (invalid) return invalid;
			const scope = parseModelScope(raw) ?? "default";
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
		// The `model` grammar is richer than sub-verb dispatch (bare-ref and
		// scope-first sugar). It lives on the group, not a transport, so every
		// surface handing raw tokens (REPL now, CLI/HTTP/TUI later) resolves alike.
		resolve: resolveModelGrammar,
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
	switch (subVerb) {
		case "current":
			return {
				renderText: (envelope) =>
					formatCurrentModelFromStatus(envelope as unknown as CurrentModelStatus),
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
					formatModelDoctorFromStatus(envelope as unknown as ModelDoctorStatus),
			};
		case "set":
		case "fallback":
		case "reset":
		case "base-url": {
			return {
				renderText: (envelope) => {
					if (envelope.ok === false) return renderCapabilityError(envelope, "model error");
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
							return chalk.green(`✓  ${m.scope} model reset to built-in default`);
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
