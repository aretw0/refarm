/**
 * THE ENVIRONMENT THIS NODE'S RUNTIME NEEDS.
 *
 * MEASURED 2026-08-19, one step after an installed node learned to START its runtime: the runtime
 * came up healthy, with the right plugins and the right sovereign directory, and refused every
 * dispatch —
 *
 *   [blocked: model-bridge task declared provider 'github-copilot', which this node did not authorise]
 *
 * `scripts/tractor-start.sh` does more than assemble arguments. It evaluates
 * `refarm model env --shell --include-secrets` before `exec`, so the host inherits the node's
 * authorisation, its provider base URLs and its credentials. A launcher that carries only the
 * arguments starts a runtime that serves and cannot work — which is worse than one that does not
 * start, because `status` says `ready`.
 *
 * SECRETS TRAVEL HERE BY NECESSITY: this is the environment of the process that spends them, and
 * it is the same content the start script has always evaluated. It is never printed, and the
 * credential FILE the host re-reads (5791626c) is what keeps it renewable afterwards.
 */
import { buildModelEnvEnvelope } from "./model.js";

export interface RuntimeNodeEnvDeps {
	/** Injected only by tests. The silo is the one place tokens live, and a caller that had to
	 *  supply them would be a second reader of the same store. */
	readonly loadTokens?: () => Promise<Record<string, unknown>>;
	readonly base?: NodeJS.ProcessEnv;
}

/**
 * The environment to hand a runtime this node starts: this process's, plus what the model
 * capability exports.
 *
 * NEVER THROWS. A runtime that starts without its model environment can still serve and be
 * repaired; one that fails to start because the environment could not be built leaves an operator
 * with a node that is simply down.
 */
export async function runtimeNodeEnv(deps: RuntimeNodeEnvDeps = {}): Promise<NodeJS.ProcessEnv> {
	const base = { ...(deps.base ?? process.env) };
	try {
		// THE SAME ASSEMBLY THE CAPABILITY DOES, because the start script reaches it through
		// `refarm model env --include-secrets` and a thinner call produces a thinner environment:
		// measured with tokens alone it exported 3 MODEL_* keys and none of the authorisation the
		// host checks before dispatching.
		const { SiloCore } = await import("@refarm.dev/silo");
		const { loadAccountCredentials, loadAccountView } = await import(
			"../credentials/account-view-loader.js"
		);
		const { readModelAuthorization } = await import("@refarm.dev/model-account-contract-v1");
		const { resolveRefarmHome } = await import("../utils/refarm-home.js");
		const nodeFs = await import("node:fs");
		const nodePath = await import("node:path");

		const home = resolveRefarmHome();
		const silo = new SiloCore() as never;
		const view = await loadAccountView({ home, silo });
		const credentials = await loadAccountCredentials({ home, silo });
		let authorization;
		try {
			authorization = readModelAuthorization(
				JSON.parse(nodeFs.default.readFileSync(nodePath.default.join(home, "config.json"), "utf8")),
			);
		} catch {
			authorization = undefined;
		}
		const tokens = deps.loadTokens
			? await deps.loadTokens()
			: (((await (silo as unknown as { loadTokens(): Promise<unknown> }).loadTokens()) ??
					{}) as Record<string, unknown>);
		const envelope = buildModelEnvEnvelope(
			tokens as Parameters<typeof buildModelEnvEnvelope>[0],
			{
				includeSecrets: true,
				view,
				credentials,
				home,
				...(authorization ? { authorization } : {}),
			},
		);
		const entries = (envelope as { env?: Record<string, string> }).env ?? {};
		for (const [key, value] of Object.entries(entries)) {
			// The caller's own environment wins: an operator who exported something deliberately
			// before starting the node meant it.
			if (base[key] === undefined) base[key] = value;
		}
	} catch {
		// Deliberate: see the note above.
	}
	return base;
}
