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

/**
 * `source` — the generic source:v1 operator surface: materialize a source into a
 * local snapshot, and inspect it. This is a NEUTRAL block: it wraps an injected
 * source:v1 provider and shapes the provenance envelope. It carries NO domain
 * vocabulary — a work app supplies the ref, the fixtures, and (via a real provider)
 * the authenticated source; refarm only knows "materialize a source, report its
 * provenance".
 *
 * Declared once → CLI, REPL `/source`, HTTP `POST /source`, and the agent tool
 * `source_pull`.
 */

export interface SourceCommandDeps {
	/** The source provider to materialize from. Injected so the verb is testable and
	 * a real (authenticated) provider swaps in without touching this host code. */
	sourceProvider: WebSourceProvider;
}

/** Default deps: a web source provider. Pass a `cacheRoot` to persist snapshots
 * between runs; omit it for an ephemeral temp cache. Callers that want the refarm
 * home (or any app-specific location) derive the cacheRoot themselves and pass it
 * in — this neutral block carries no app FS layout. */
export function defaultSourceDeps(cacheRoot?: string): SourceCommandDeps {
	const root = cacheRoot ?? mkdtempSync(path.join(os.tmpdir(), "refarm-source-"));
	return { sourceProvider: createWebSourceProvider({ cacheRoot: root }) };
}

export function createSourceCapabilityGroup(
	deps: SourceCommandDeps = defaultSourceDeps(),
): CapabilityGroup {
	const pull: CapabilityDescriptor = {
		name: "pull",
		summary: "Materialize a source into a local snapshot (offline replay by default)",
		args: [{ name: "ref", required: true }],
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
			const ref = input.args.ref as string;
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
					command: "source",
					operation: "pull",
					nextCommand: "source status",
					nextCommands: ["source status"],
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
					command: "source",
					operation: "pull",
					error: "source_pull_failed",
					message,
					nextAction:
						"Pass a source ref the injected provider understands, e.g. an offline-replayable fixture ref.",
				});
			}
		},
	};

	const status: CapabilityDescriptor = {
		name: "status",
		summary: "Show whether a source has been materialized + its snapshot state",
		args: [{ name: "ref", required: true }],
		async run(input): Promise<CapabilityEnvelope> {
			const ref = input.args.ref as string;
			const state = await deps.sourceProvider.status(ref);
			return buildJsonSuccessEnvelope({
				command: "source",
				operation: "status",
				extra: { ref, providerId: deps.sourceProvider.pluginId, status: state },
			});
		},
	};

	return {
		name: "source",
		summary: "Materialize and inspect source:v1 snapshots",
		actions: { pull, status },
		defaultAction: "status",
		transports: {
			cli: {},
			repl: {},
			http: { method: "POST", path: "/source" },
			// A read step the agent can drive as a tool: materializing a source widens
			// REACH (the agent can seed from a source), the provider is
			// side-effect-honest (offline replay), no shell/network power of its own.
			agent: { tool: true, toolName: "source_pull" },
		},
		renderers: { tui: { section: "sources" } },
	};
}
