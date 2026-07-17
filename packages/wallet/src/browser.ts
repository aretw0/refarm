/**
 * The BROWSER-safe wallet entry. The main barrel (index.ts) re-exports persona/credentials/
 * verifier, which import `@refarm.dev/capability-host/node` + `node:fs` — so importing it in a
 * browser bundle crashes at module init (Vite stubs node: to undefined → `Class extends value
 * undefined`). This entry re-exports ONLY the browser-safe pieces a web face needs: the consent-
 * journey verb factories (consent.ts / authorization.ts, which touch no node) and the in-memory
 * authorization fixture. A web boot builds a live wallet registry from these + an in-memory
 * records source, never importing the CLI or a node path.
 *
 * Node-bound assembly (walletCapabilityBundle, credentials/verifier providers) stays on the main
 * barrel for CLI/test use; only the isomorphic core is surfaced here.
 */
export {
	createWalletRequestCapability,
	createWalletConsentCapability,
	createWalletDeclineCapability,
} from "./consent.js";
export {
	createWalletAuthorizeCapability,
	createWalletRevokeCapability,
	createWalletPresentCapability,
} from "./authorization.js";
export { createInMemoryAuthorizationProviderFixture } from "@refarm.dev/authorization-contract-v1";
