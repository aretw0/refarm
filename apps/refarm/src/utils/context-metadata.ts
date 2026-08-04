import { resolveSiloHome } from "@refarm.dev/silo";
import path from "node:path";
import { resolveRefarmHome } from "./refarm-home.js";

export interface NodeContextMetadata {
	mode: "node" | "workspace";
	binding: {
		kind: "attached" | "detached";
		origin: "explicit" | "default";
	};
	state: {
		policy: "node-owned" | "workspace-owned";
		homeRef: string;
	};
	sovereignHome: string;
	credentialStoreHome: string;
	homesAligned: boolean;
}

export function resolveNodeContextMetadata(
	env = process.env,
	cwd = process.cwd(),
): NodeContextMetadata {
	const sovereignHome = resolveRefarmHome(env);
	const credentialStoreHome = resolveSiloHome(env);
	const workspaceHome = path.join(cwd, ".refarm");
	const isWorkspaceScoped =
		path.resolve(sovereignHome) === path.resolve(workspaceHome)
			? true
			: false;
	const mode = isWorkspaceScoped ? "workspace" : "node";
	const homesAligned = path.resolve(sovereignHome) === path.resolve(credentialStoreHome);
	return {
		mode,
		binding: {
			kind: isWorkspaceScoped ? "attached" : "detached",
			origin: env.REFARM_HOME?.trim() ? "explicit" : "default",
		},
		state: {
			policy: isWorkspaceScoped ? "workspace-owned" : "node-owned",
			homeRef: sovereignHome,
		},
		sovereignHome,
		credentialStoreHome,
		homesAligned,
	};
}