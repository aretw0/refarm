/**
 * `@refarm.dev/certificate-local-ca` — the canonical certificate provider, and the consent-carried
 * request to trust its CA on a device.
 *
 * See `provider.ts` for the four bounds on one-CA-per-operator, `extensions.ts` for the name
 * constraint and its honest caveat, `trust.ts` for T4, and `nss.ts` for the store a browser
 * ACTUALLY reads on Linux — the one that needs no privilege.
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
	CERTUTIL_MISSING_FIX,
	certutilAddArgs,
	certutilCommandLine,
	certutilDeleteArgs,
	certutilListArgs,
	chromiumNssDir,
	createNodeCertutilRunner,
	createNodeNssDiscoveryIo,
	createNssOperationFileSystem,
	DEFAULT_CERTUTIL_BIN,
	describeNssStoreReach,
	detectCertutil,
	discoverNssStores,
	firefoxProfileRoots,
	NSS_CA_TRUST_FLAGS,
	NSS_DATABASE_FILE,
	NSS_ENTRY_SEPARATOR,
	nssDbSpec,
	nssEntryPath,
	parseFirefoxProfilesIni,
	parseNssEntryPath,
	type CertutilPresence,
	type CertutilResult,
	type CertutilRunner,
	type DiscoverNssStoresOptions,
	type FirefoxProfileEntry,
	type NssDiscoveryIo,
	type NssStore,
	type NssStoreKind,
	type NssStoreReach,
} from "./nss.js";
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
	readLocalCaNameSuffixes,
	subjectCommonName,
	type LocalCaHandle,
	type LocalCaOptions,
	type LocalCaProvider,
} from "./provider.js";
export {
	buildCaTrustRequest,
	buildNssCaTrustRequest,
	CA_TRUST_OPERATION_KIND,
	describeCaGrant,
	linuxCaAnchorPath,
	type CaGrantSurface,
	type CaTrustRequestInput,
	type NssCaTrustRequestInput,
} from "./trust.js";
