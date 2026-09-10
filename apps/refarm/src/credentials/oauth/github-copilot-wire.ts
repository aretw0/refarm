/**
 * MOVED to `@refarm.dev/github-copilot-wire` (ISS-142).
 *
 * GitHub publishes no supported model API billed against a Copilot subscription, so this shape is
 * read from behaviour and pinned by tests rather than cited from a contract — which is exactly the
 * kind of knowledge that must live in ONE block. Three consumers need it and could not share it:
 * this CLI provisions the runtime and renews a seat before handing it over, the daemon renews
 * mid-run, and `apps/farmhand` cannot import from `apps/refarm`.
 *
 * It spent one slice inside `@refarm.dev/model-account-contract-v1` as a waypoint. That was the
 * wrong home for the opposite reason: the contract package is the GENERIC account vocabulary, and
 * a provider's quirks settling there is how a contract quietly becomes an adapter. The generic
 * package must not depend on a provider block — the arrow only points the other way.
 *
 * Re-exported here so every reader in this app keeps its import path.
 */
export {
	COPILOT_EXCHANGE_HEADERS,
	COPILOT_SCOPE,
	copilotAccountId,
	copilotApiBaseUrl,
	copilotRefreshMargin,
	copilotTokenExchangeUrl,
	GITHUB_ACCESS_TOKEN_URL,
	GITHUB_COPILOT_STATUS_COMPONENT,
	GITHUB_DEVICE_CODE_URL,
	GITHUB_STATUS_SUMMARY_URL,
	parseCopilotTokenFields,
	REFRESH_MARGIN_MS,
	renewedCopilotCredential,
	type CopilotApiBaseUrl,
} from "@refarm.dev/github-copilot-wire";

export { explainRefusal, latestIncidentNote, readProviderStatus, type ProviderStatus } from "@refarm.dev/model-account-contract-v1";
