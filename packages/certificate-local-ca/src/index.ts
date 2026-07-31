/**
 * `@refarm.dev/certificate-local-ca` — the canonical certificate provider, and the consent-carried
 * request to trust its CA on a device.
 *
 * See `provider.ts` for the four bounds on one-CA-per-operator, `extensions.ts` for the name
 * constraint and its honest caveat, and `trust.ts` for T4.
 */

export {
	assertNamesUnderSuffixes,
	caConfigFile,
	caExtensions,
	certificateFileStem,
	leafConfigFile,
	leafExtensions,
	LINUX_CA_ANCHOR_DIR,
	LINUX_CA_REFRESH_COMMAND,
	nameIsUnderSuffixes,
	normalizeNameSuffixes,
} from "./extensions.js";
export {
	createNodeOpensslRunner,
	DEFAULT_OPENSSL_BIN,
	detectOpenssl,
	OPENSSL_MISSING_FIX,
	redactPrivateKeys,
	type OpensslPresence,
	type OpensslResult,
	type OpensslRunner,
} from "./openssl.js";
export {
	createLocalCaProvider,
	LOCAL_CA_PROVIDER_ID,
	subjectCommonName,
	type LocalCaHandle,
	type LocalCaOptions,
	type LocalCaProvider,
} from "./provider.js";
export {
	buildCaTrustRequest,
	CA_TRUST_OPERATION_KIND,
	describeCaGrant,
	linuxCaAnchorPath,
	type CaTrustRequestInput,
} from "./trust.js";
