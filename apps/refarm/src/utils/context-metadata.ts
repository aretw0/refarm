import { resolveSiloHome } from "@refarm.dev/silo";
import path from "node:path";
import { resolveRefarmHome } from "./refarm-home.js";

export interface NodeContextMetadata {
	mode: "node-global" | "workspace-hatch";
	sovereignHome: string;
	credentialStoreHome: string;
	homesAligned: boolean;
}

export function resolveNodeContextMetadata(env = process.env): NodeContextMetadata {
	const sovereignHome = resolveRefarmHome(env);
	const credentialStoreHome = resolveSiloHome(env);
	const homesAligned = path.resolve(sovereignHome) === path.resolve(credentialStoreHome);
	return {
		mode: "node-global",
		sovereignHome,
		credentialStoreHome,
		homesAligned,
	};
}