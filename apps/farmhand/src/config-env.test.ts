import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectConfigEnv } from "./config-env.js";

function tempDir(): string {
	return path.join(tmpdir(), `refarm-farmhand-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function writeRefarmConfig(base: string, config: Record<string, unknown>): void {
	const dir = path.join(base, ".refarm");
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "config.json"), JSON.stringify(config), "utf8");
}

describe("injectConfigEnv", () => {
	let cwd: string;
	let home: string;

	beforeEach(() => {
		cwd = tempDir();
		home = tempDir();
		mkdirSync(cwd, { recursive: true });
		mkdirSync(home, { recursive: true });
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it("injects model env values from home config", async () => {
		const env: NodeJS.ProcessEnv = {};
		writeRefarmConfig(home, {
			MODEL_ID: "gpt-5.5",
			MODEL_HISTORY_TURNS: 8,
		});

		await injectConfigEnv({ cwd, home, env });

		expect(env.MODEL_ID).toBe("gpt-5.5");
		expect(env.MODEL_HISTORY_TURNS).toBe("8");
	});

	it("lets project-local config override home config", async () => {
		const env: NodeJS.ProcessEnv = {};
		writeRefarmConfig(home, {
			MODEL_ID: "gpt-5.5",
			MODEL_SYSTEM: "home system",
		});
		writeRefarmConfig(cwd, {
			MODEL_ID: "gemini-3-flash-preview",
		});

		await injectConfigEnv({ cwd, home, env });

		expect(env.MODEL_ID).toBe("gemini-3-flash-preview");
		expect(env.MODEL_SYSTEM).toBe("home system");
	});

	it("does not override operator-provided env values", async () => {
		const env: NodeJS.ProcessEnv = {
			MODEL_ID: "operator-model",
		};
		writeRefarmConfig(home, {
			MODEL_ID: "gpt-5.5",
		});
		writeRefarmConfig(cwd, {
			MODEL_ID: "gemini-3-flash-preview",
		});

		await injectConfigEnv({ cwd, home, env });

		expect(env.MODEL_ID).toBe("operator-model");
	});

	it("ignores malformed config and continues with later config", async () => {
		const env: NodeJS.ProcessEnv = {};
		writeRefarmConfig(home, {
			MODEL_ID: "gpt-5.5",
		});
		const cwdConfigDir = path.join(cwd, ".refarm");
		mkdirSync(cwdConfigDir, { recursive: true });
		writeFileSync(path.join(cwdConfigDir, "config.json"), "{", "utf8");

		await injectConfigEnv({ cwd, home, env });

		expect(env.MODEL_ID).toBe("gpt-5.5");
	});
});
