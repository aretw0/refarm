import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import {
	createWebSourceProvider,
	type WebSourceProvider,
} from "@refarm.dev/source-web";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveRefarmHome } from "../utils/refarm-home.js";

/**
 * `requirements` — the T3 operator surface: pull requirements from a source, the
 * first step of the notes-box workflow (vault from 0 → pull requirements → correct
 * → enrich). Declared ONCE as a CapabilityGroup, so it lights up on CLI, the REPL
 * `/requirements` slash, HTTP (via `serve`), and — because it opts into
 * `transports.agent.tool` — the agent can pull requirements as a tool too.
 *
 * The compute is the ALREADY-PROVEN source:v1 provider (packages/source-web),
 * exercised end-to-end in scripts/ci/requirements-supply-composition.mjs. This wraps
 * it as a runnable verb — no new scraping logic. The reference/fixture provider is
 * deterministic (the artifact exists before the run), and the real SERPRO source
 * (login + ALM scraping) is a downstream provider swap, not a change here.
 */

export interface RequirementsCommandDeps {
	/** The source provider to pull from. Injected so the verb is testable + the real
	 * SERPRO provider swaps in downstream without touching this host code. */
	sourceProvider: WebSourceProvider;
}

/** Default deps: a web source provider caching under the refarm home so a pulled
 * snapshot persists between runs (the operator can `status` it later). */
export function defaultRequirementsDeps(): RequirementsCommandDeps {
	let cacheRoot: string;
	try {
		cacheRoot = path.join(resolveRefarmHome(), "requirements-cache");
	} catch {
		cacheRoot = mkdtempSync(path.join(os.tmpdir(), "refarm-requirements-"));
	}
	return { sourceProvider: createWebSourceProvider({ cacheRoot }) };
}

export function createRequirementsCapabilityGroup(
	deps: RequirementsCommandDeps = defaultRequirementsDeps(),
): CapabilityGroup {
	const pull: CapabilityDescriptor = {
		name: "pull",
		summary:
			"Pull requirements from a source into the vault (offline/fixture by default)",
		args: [{ name: "ref", required: false }],
		options: [
			{
				name: "online",
				kind: "boolean",
				summary: "Allow network egress (default: offline replay of a cached snapshot)",
			},
			{
				name: "force",
				kind: "boolean",
				summary: "Re-materialize even if a snapshot already exists",
			},
		],
		async run(input): Promise<CapabilityEnvelope> {
			const ref =
				(input.args.ref as string | undefined) ?? "web:requirements-fixture";
			const offline = input.options.online !== true;
			try {
				const result = await deps.sourceProvider.materialize(ref, {
					offline,
					force: input.options.force === true,
				});
				// snapshotProvenance is the WebSourceProvider's typed accessor for the
				// same audit data materialize carries — session/cache/redaction.
				const provenance = await deps.sourceProvider.snapshotProvenance(ref);
				return buildJsonSuccessEnvelope({
					command: "requirements",
					operation: "pull",
					nextCommand: "requirements status",
					nextCommands: ["requirements status", "records enrich"],
					extra: {
						ref,
						providerId: deps.sourceProvider.pluginId,
						action: result.action, // cloned | fetched | reused | noop
						location: result.location,
						head: result.head,
						offline,
						// The audit-worthy provenance: whether it was an authenticated
						// session, offline replay, and whether redaction was applied.
						provenance: provenance
							? {
									authenticated: provenance.session.authenticated,
									offlineReplay: provenance.cache.offlineReplay === true,
									redacted: provenance.redaction.applied === true,
									hash: provenance.cache.hash,
								}
							: null,
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return buildJsonErrorEnvelope({
					command: "requirements",
					operation: "pull",
					error: "requirements_pull_failed",
					message,
					nextAction:
						"Check the source ref; the default `web:requirements-fixture` replays offline.",
				});
			}
		},
	};

	const status: CapabilityDescriptor = {
		name: "status",
		summary: "Show whether a requirements source has been pulled + its snapshot state",
		args: [{ name: "ref", required: false }],
		async run(input): Promise<CapabilityEnvelope> {
			const ref =
				(input.args.ref as string | undefined) ?? "web:requirements-fixture";
			const state = await deps.sourceProvider.status(ref);
			return buildJsonSuccessEnvelope({
				command: "requirements",
				operation: "status",
				extra: { ref, providerId: deps.sourceProvider.pluginId, status: state },
			});
		},
	};

	return {
		name: "requirements",
		summary: "Pull and inspect requirements sources for the notes box (T3)",
		actions: { pull, status },
		defaultAction: "status",
		transports: {
			cli: {},
			repl: {},
			http: { method: "POST", path: "/requirements" },
			// A read step the agent can drive as a tool: pulling requirements widens
			// REACH (the agent can seed the vault), the reference provider is
			// side-effect-honest (offline fixture materialize), no shell/network power.
			agent: { tool: true, toolName: "requirements_pull" },
		},
		renderers: { tui: { section: "notes-box" } },
	};
}
