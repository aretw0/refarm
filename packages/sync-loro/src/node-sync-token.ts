/**
 * Node-only default for `BrowserSyncClient`'s `token` option (ADR-093).
 *
 * `BrowserSyncClient` itself stays environment-agnostic — it also runs in a
 * browser, where there is no `process.env` to read (see its `token` option
 * doc in `browser-sync-client.ts`). A Node/CLI caller that wants the
 * operator's device credential without threading it through by hand can use
 * this instead: an explicit token always wins; absent, it falls back to
 * `FARM_TOKEN`; absent/empty that too ⇒ `undefined`, matching
 * `BrowserSyncClient`'s own "no token ⇒ no `Sec-WebSocket-Protocol` offered
 * at all" behavior, so an ungated farm's handshake stays unaffected.
 *
 * Deliberately NOT re-exported from the package index — a browser bundle must
 * never pull in a `process.env` reference. Node/CLI call sites import it
 * directly (see `scripts/smoke-browser-sync-runtime.mjs`).
 */
export function resolveNodeFarmSyncToken(
	explicitToken?: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	if (explicitToken !== undefined) return explicitToken;
	const token = typeof env.FARM_TOKEN === "string" ? env.FARM_TOKEN.trim() : "";
	return token.length > 0 ? token : undefined;
}
