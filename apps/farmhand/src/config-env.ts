import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ConfigEnvOptions {
	cwd?: string;
	home?: string;
	env?: NodeJS.ProcessEnv;
}

const CONFIG_ENV_MAP: Record<string, string> = {
	MODEL_FS_ROOT: "MODEL_FS_ROOT",
	MODEL_SHELL_ALLOWLIST: "MODEL_SHELL_ALLOWLIST",
	MODEL_HISTORY_TURNS: "MODEL_HISTORY_TURNS",
	MODEL_TOOL_CALL_MAX_ITER: "MODEL_TOOL_CALL_MAX_ITER",
	MODEL_STREAM_RESPONSES: "MODEL_STREAM_RESPONSES",
	MODEL_SYSTEM: "MODEL_SYSTEM",
	MODEL_ID: "MODEL_ID",
};

async function readJsonConfig(filePath: string): Promise<Record<string, unknown> | null> {
	const raw = await readFile(filePath, "utf8").catch(() => null);
	if (!raw) return null;
	return JSON.parse(raw) as Record<string, unknown>;
}

export async function injectConfigEnv(options: ConfigEnvOptions = {}): Promise<void> {
	const env = options.env ?? process.env;
	const originalEnvKeys = new Set(Object.keys(env));
	const home = options.home ?? os.homedir();
	const cwd = options.cwd ?? process.cwd();

	for (const filePath of [
		path.join(home, ".refarm", "config.json"),
		path.join(cwd, ".refarm", "config.json"),
	]) {
		try {
			const config = await readJsonConfig(filePath);
			if (!config) continue;
			for (const [cfgKey, envKey] of Object.entries(CONFIG_ENV_MAP)) {
				if (originalEnvKeys.has(envKey)) continue;
				const value = config[cfgKey];
				if (value !== undefined && value !== null) {
					env[envKey] = String(value);
				}
			}
		} catch {
			// config injection is best-effort
		}
	}
}
