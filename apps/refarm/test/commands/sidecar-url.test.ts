import { describe, expect, it } from "vitest";
import {
	DEFAULT_SIDECAR_URL,
	SIDECAR_URL_ENV_VAR,
	normalizeSidecarUrl,
	resolveSidecarUrl,
	sidecarUrl,
} from "../../src/commands/sidecar-url.js";

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
});
