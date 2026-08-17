/**
 * MOVED. The GitHub Copilot wire now lives in `@refarm.dev/model-account-contract-v1` because the
 * daemon needs it: renewing a Copilot credential is a re-exchange of the durable `ghu_`, not an
 * OAuth refresh grant, and `apps/farmhand` cannot import from `apps/refarm`. Re-exported here so
 * every existing reader in this app keeps its import path, and so there stays exactly ONE
 * implementation of an endpoint nobody documents.
 */
export {
	COPILOT_SCOPE,
	explainRefusal,
	GITHUB_COPILOT_STATUS_COMPONENT,
	GITHUB_STATUS_SUMMARY_URL,
	latestIncidentNote,
	readProviderStatus,
	type ProviderStatus,
	copilotAccountId,
	copilotApiBaseUrl,
	copilotRefreshMargin,
	copilotTokenExchangeUrl,
	GITHUB_ACCESS_TOKEN_URL,
	GITHUB_DEVICE_CODE_URL,
	parseCopilotTokenFields,
	REFRESH_MARGIN_MS,
	type CopilotApiBaseUrl,
} from "@refarm.dev/model-account-contract-v1";
