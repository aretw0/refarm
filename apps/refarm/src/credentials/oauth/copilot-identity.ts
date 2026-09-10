/**
 * MOVED to `@refarm.dev/github-copilot-wire` (ISS-142).
 *
 * The client identity refarm presents to Copilot is part of that provider's undocumented surface,
 * not of this app: `apps/farmhand` renews a seat mid-run and must present the SAME identity the
 * login did — "both halves or neither" — and it cannot import from `apps/refarm`.
 *
 * Re-exported so every reader here keeps its import path.
 */
export {
	copilotRequestIdentity,
	describeCopilotIdentity,
	EDITOR_IMITATION,
	resolveCopilotIdentity,
	type CopilotIdentity,
	type CopilotRequestIdentity,
} from "@refarm.dev/github-copilot-wire";
