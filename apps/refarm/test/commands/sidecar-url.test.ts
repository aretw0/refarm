import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_SIDECAR_URL,
	SIDECAR_URL_ENV_VAR,
	normalizeSidecarUrl,
	resolveSidecarUrl,
	resolveSidecarUrlAsync,
	sidecarUrl,
	sidecarUrlAsync,
} from "../../src/commands/sidecar-url.js";
import { resolveRuntimeSidecarUrl } from "../../src/utils/runtime-config.js";
import { resetAllProcessCaches } from "../../src/utils/process-cache.js";

describe("sidecar URL resolution", () => {
	it("uses the local sidecar URL by default", () => {
		expect(resolveSidecarUrl({})).toBe(DEFAULT_SIDECAR_URL);
		expect(sidecarUrl("/sessions", {})).toBe(
			`${DEFAULT_SIDECAR_URL}/sessions`,
		);
	});

	it("uses REFARM_SIDECAR_URL when configured", () => {
		const env = {
			[SIDECAR_URL_ENV_VAR]: " http://127.0.0.1:52001/ ",
		};

		expect(resolveSidecarUrl(env)).toBe("http://127.0.0.1:52001");
		expect(sidecarUrl("telemetry", env)).toBe(
			"http://127.0.0.1:52001/telemetry",
		);
	});

	it("normalizes trailing slashes", () => {
		expect(normalizeSidecarUrl("http://localhost:42001///")).toBe(
			"http://localhost:42001",
		);
	});

	it("uses project-local runtime sidecar URL config before home config", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sidecar-cwd-"));
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sidecar-home-"));
		try {
			fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
			fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
			fs.writeFileSync(
				path.join(home, ".refarm", "config.json"),
				JSON.stringify({ runtime: { sidecarUrl: "http://127.0.0.1:42001" } }),
				"utf-8",
			);
			fs.writeFileSync(
				path.join(cwd, ".refarm", "config.json"),
				JSON.stringify({ runtime: { sidecarUrl: "http://127.0.0.1:52001/" } }),
				"utf-8",
			);

			expect(resolveRuntimeSidecarUrl({ cwd, home, env: {} })).toEqual({
				value: "http://127.0.0.1:52001",
				source: path.join(cwd, ".refarm", "config.json"),
			});
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
			fs.rmSync(home, { recursive: true, force: true });
		}
	});
});

describe("resolveSidecarUrlAsync (node-aware, memoized)", () => {
	// The global setup (vitest.setup.ts) already clears every process cache before
	// each test, so no per-test reset is needed for isolation between tests.

	it("resolves the env URL and joins a path via sidecarUrlAsync", async () => {
		const env = { [SIDECAR_URL_ENV_VAR]: "http://127.0.0.1:52001" };
		expect(await resolveSidecarUrlAsync(env)).toBe("http://127.0.0.1:52001");
		expect(await sidecarUrlAsync("/efforts", env)).toBe(
			"http://127.0.0.1:52001/efforts",
		);
	});

	it("memoizes: the first resolution is reused, later env changes are ignored until reset", async () => {
		const first = await resolveSidecarUrlAsync({
			[SIDECAR_URL_ENV_VAR]: "http://first:1",
		});
		expect(first).toBe("http://first:1");
		// A different env after the cache is warm returns the cached value — the
		// sidecar URL is stable for the process lifetime.
		expect(
			await resolveSidecarUrlAsync({ [SIDECAR_URL_ENV_VAR]: "http://second:2" }),
		).toBe("http://first:1");
		// The canonical reset (also run by the global beforeEach) forces re-resolution.
		resetAllProcessCaches();
		expect(
			await resolveSidecarUrlAsync({ [SIDECAR_URL_ENV_VAR]: "http://second:2" }),
		).toBe("http://second:2");
	});
});
