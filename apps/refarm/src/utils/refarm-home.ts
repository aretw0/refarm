import os from "node:os";
import path from "node:path";

export function resolveRefarmHome(env = process.env): string {
	const refarmHome = env.REFARM_HOME?.trim();
	if (refarmHome) return refarmHome;
	return path.join(os.homedir(), ".refarm");
}

/** The installed-plugins root under the refarm home (`<home>/plugins`). */
export function pluginsBaseDir(env = process.env): string {
	return path.join(resolveRefarmHome(env), "plugins");
}

/**
 * The ORG root — the shared base an organization distributes, which layers UNDER
 * user and workspace (org < workspace < user). Unlike the user/workspace roots it
 * has no default: an org is opt-in, and it is the first tier a content-addressed
 * resolver serves (a mounted/synced dir via `REFARM_ORG_HOME` today; a p2p/OPFS
 * backend later). Returns undefined when unset, so callers simply drop the org
 * layer rather than inventing a local one.
 */
export function resolveOrgRoot(env = process.env): string | undefined {
	const orgHome = env.REFARM_ORG_HOME?.trim();
	return orgHome ? orgHome : undefined;
}
