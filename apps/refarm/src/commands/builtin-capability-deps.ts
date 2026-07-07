import {
	defaultSourceDeps,
	defaultVaultDeps,
	type SourceCommandDeps,
	type VaultCommandDeps,
} from "@refarm.dev/capabilities-v1";
import path from "node:path";

import { resolveRefarmHome } from "../utils/refarm-home.js";
import { submitEffortViaSidecar } from "./dispatch-submit.js";
import { discoverVaultProviders } from "./vault-discovery.js";

/**
 * The app-side plumbing that turns the neutral capability blocks
 * (`@refarm.dev/capabilities-v1`) into fully-wired deps for THIS host. The package
 * carries no app FS layout or runtime knowledge; refarm supplies its own here — the
 * refarm-home cache location, the plugins-dir discovery, the sidecar effort sink.
 * A white-label app writes its OWN equivalent of this file.
 */

/** The source deps for the refarm app: cache snapshots under the refarm home so a
 * pull persists between runs (falls back to an ephemeral temp cache if the home
 * can't be resolved). */
export function refarmSourceDeps(): SourceCommandDeps {
	try {
		return defaultSourceDeps(path.join(resolveRefarmHome(), "source-cache"));
	} catch {
		return defaultSourceDeps(); // ephemeral temp cache fallback
	}
}

/** The vault deps for the refarm app: discover providers from the refarm plugins
 * dir, submit efforts via the sidecar. refarm ships NO seed (that would be domain
 * vocabulary) — `vault init` yields an empty vault unless a work app injects one. */
export function refarmVaultDeps(): VaultCommandDeps {
	return defaultVaultDeps({
		discover: () => discoverVaultProviders(),
		submitEffort: submitEffortViaSidecar,
	});
}
