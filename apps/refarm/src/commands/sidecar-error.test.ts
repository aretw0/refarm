import { describe, expect, it } from "vitest";
import { isSidecarUnavailable } from "./sidecar-error.js";

describe("sidecar-error", () => {
	it("recognizes transport and runtime HTTP failures as runtime unavailable", () => {
		expect(isSidecarUnavailable("fetch failed")).toBe(true);
		expect(isSidecarUnavailable("connect ECONNREFUSED 127.0.0.1:42001")).toBe(true);
		expect(isSidecarUnavailable("Runtime HTTP 503")).toBe(true);
		expect(isSidecarUnavailable("Farmhand HTTP 503")).toBe(true);
	});

	it("does not treat generic sidecar HTTP status as unavailable", () => {
		expect(isSidecarUnavailable("sidecar HTTP 404")).toBe(false);
	});
});
