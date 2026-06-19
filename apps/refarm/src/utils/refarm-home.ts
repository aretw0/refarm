import os from "node:os";
import path from "node:path";

export function resolveRefarmHome(env = process.env): string {
	const refarmHome = env.REFARM_HOME?.trim();
	if (refarmHome) return refarmHome;
	return path.join(os.homedir(), ".refarm");
}
