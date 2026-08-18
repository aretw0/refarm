/**
 * WHO REFARM SAYS IT IS AT THE COPILOT EXCHANGE — one declared profile, three values, one code path.
 *
 * ## Why this is a profile and not three adapters
 *
 * Measured 2026-08-14 on a real node: the caller's own OAuth App authenticates fine — the device
 * flow completes and GitHub issues a user token — and then `copilot_internal/v2/token` answers
 * **HTTP 403**. Not 401. Authenticated, and not authorised. The endpoint honours some identities and
 * not others.
 *
 * The three ways forward are the SAME transport with a different identity: same endpoint, same
 * device flow, same token parsing, same refresh. They differ in a client id and three headers.
 * Writing three adapters for that would triple what has to be maintained and would make the day
 * GitHub grants an integration id into a migration instead of an edit.
 *
 * The OTHER path — the official Copilot SDK/CLI — is deliberately NOT here. It owns the agent loop
 * and is a runtime, not a transport, and the governing design forbids presenting the two as two
 * implementations of one adapter. It arrives as its own capability or not at all.
 *
 * ## Imitation is a decision, never a default
 *
 * `editor-imitation` works because it presents another product's client id and version headers. The
 * operator may accept that risk — the design allows it explicitly — but nothing may reach it by
 * accident, and a node using it must SAY so wherever credentials are reported. An impersonation
 * nobody remembers choosing is one that breaks without anyone knowing why.
 */

/** The editor identity `@earendil-works/pi-ai` presents, read from the installed package 2026-08-14. */
export const EDITOR_IMITATION = {
	/** Not the caller's, and not pi's either: the Copilot editor-plugin family's. */
	clientId: "Iv1.b507a08c87ecfe98",
	headers: {
		"User-Agent": "GitHubCopilotChat/0.35.0",
		"Editor-Version": "vscode/1.107.0",
		"Editor-Plugin-Version": "copilot-chat/0.35.0",
		"Copilot-Integration-Id": "vscode-chat",
	},
} as const;

export type CopilotIdentity =
	/** Refarm's own OAuth App and honest headers. Measured 403 at the exchange, and still the default. */
	| { readonly kind: "own" }
	/** Another product's client id and version headers. Works; the operator accepted the risk. */
	| { readonly kind: "editor-imitation" }
	/** Refarm's own identity, authorised by an integration id GitHub granted. */
	| { readonly kind: "integration"; readonly id: string };

interface CopilotIdentityConfig {
	providers?: { githubCopilot?: { identity?: unknown; integrationId?: unknown } };
}

/**
 * PURE. The declared profile, defaulting to the honest identity.
 *
 * Every unrecognised or half-declared value falls back to `own`. That is deliberate and it is the
 * safe direction: falling back to imitation would make a typo impersonate another product, and
 * falling back to an empty integration id would send a header that means nothing. Failing visibly
 * at the exchange is better than either.
 */
export function resolveCopilotIdentity(config: unknown): CopilotIdentity {
	const declared = (config as CopilotIdentityConfig | null | undefined)?.providers?.githubCopilot;
	const kind = typeof declared?.identity === "string" ? declared.identity : undefined;
	if (kind === "editor-imitation") return { kind: "editor-imitation" };
	if (kind === "integration") {
		const id = typeof declared?.integrationId === "string" ? declared.integrationId.trim() : "";
		return id ? { kind: "integration", id } : { kind: "own" };
	}
	return { kind: "own" };
}

export interface CopilotRequestIdentity {
	readonly clientId: string;
	readonly headers: Record<string, string>;
}

/** PURE. The client id and headers this profile sends. The ONLY place either is decided. */
export function copilotRequestIdentity(
	identity: CopilotIdentity,
	/** The CALLER's own OAuth client id, when it presents as itself. */
	ownClientId: string,
	/** How the caller names itself in `User-Agent`. INJECTED, never built
	 *  here: a provider adapter that hardcoded one consumer name could not be used by another,
	 *  and this package is deliberately reusable outside whatever ships it. */
	ownUserAgent: string,
): CopilotRequestIdentity {
	const base = { Accept: "application/json", "Content-Type": "application/json" };
	if (identity.kind === "editor-imitation") {
		// BOTH HALVES OR NEITHER. A borrowed client id without the matching headers, or the reverse,
		// is a shape no real client sends: it impersonates and it does not work.
		return { clientId: EDITOR_IMITATION.clientId, headers: { ...base, ...EDITOR_IMITATION.headers } };
	}
	const honest = { ...base, "User-Agent": ownUserAgent };
	if (identity.kind === "integration") {
		// Refarm's OWN client id, authorised by the granted id. Pairing a granted id with a borrowed
		// client id would be imitation wearing a licence.
		return {
			clientId: ownClientId,
			headers: { ...honest, "Copilot-Integration-Id": identity.id },
		};
	}
	return { clientId: ownClientId, headers: honest };
}

/**
 * PURE. What to tell the operator about this profile, or `null` when there is nothing to say.
 *
 * The honest identity says nothing, because it is the expectation. The other two are reported
 * wherever credentials are — a node that imitates in silence is a node nobody knows will break.
 */
export function describeCopilotIdentity(identity: CopilotIdentity): string | null {
	switch (identity.kind) {
		case "own":
			return null;
		case "editor-imitation":
			return (
				"github-copilot is reaching an undocumented endpoint by IMITATING an editor client. " +
				"This works today and may be blocked without notice; it is a declared choice, not a default. " +
				"Clear providers.githubCopilot.identity to stop."
			);
		case "integration":
			return `github-copilot is using the granted integration id "${identity.id}" under this node's own identity.`;
	}
}
