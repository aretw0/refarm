import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_SIDECAR_URL,
	SIDECAR_URL_ENV_VAR,
	normalizeSidecarUrl,
	resolveSidecarUrl,
	sidecarUrl,
} from "../../src/commands/sidecar-url.js";
import { resolveRuntimeSidecarUrl } from "../../src/utils/runtime-config.js";

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
