import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRuntimeSidecarUrlAsync } from "./runtime-config.js";

describe("resolveRuntimeSidecarUrlAsync", () => {
	let home: string;
	let cwd: string;
	beforeEach(() => {
		home = mkdtempSync(path.join(tmpdir(), "rc-home-"));
		cwd = mkdtempSync(path.join(tmpdir(), "rc-cwd-"));
	});
	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	});

	const noConfig = async () => null;

	it("prefers the env var over everything (never reads the seam)", async () => {
		let seamCalled = false;
		const seam = async () => {
			seamCalled = true;
			return { runtime: { sidecarUrl: "http://node:1" } };
		};
		const out = await resolveRuntimeSidecarUrlAsync(seam, {
			env: { REFARM_SIDECAR_URL: "http://env:9" },
			home,
			cwd,
		});
		expect(out).toEqual({ value: "http://env:9", source: "env:REFARM_SIDECAR_URL" });
		expect(seamCalled).toBe(false);
	});

	it("the cwd/seam value wins over the home file (parity with the sync 'last wins')", async () => {
		// Both home and the seam (cwd fs / node) have a URL. The sync resolver's
		// [home, cwd] loop is last-wins → cwd beats home; the async path must match.
		mkdirSync(path.join(home, ".refarm"), { recursive: true });
		writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ runtime: { sidecarUrl: "http://home:2" } }),
		);
		const seam = async () => ({ runtime: { sidecarUrl: "http://cwd:3" } });
		const out = await resolveRuntimeSidecarUrlAsync(seam, { env: {}, home, cwd });
		expect(out).toEqual({ value: "http://cwd:3", source: "sovereign-config" });
	});

	it("falls back to the home file when the seam has no URL", async () => {
		mkdirSync(path.join(home, ".refarm"), { recursive: true });
		writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ runtime: { sidecarUrl: "http://home:5" } }),
		);
		const out = await resolveRuntimeSidecarUrlAsync(noConfig, { env: {}, home, cwd });
		expect(out).toEqual({ value: "http://home:5", source: "home" });
	});

	it("uses the sovereign-config seam (cwd fs / node) when env + home are absent", async () => {
		const seam = async () => ({ runtime: { sidecarUrl: "http://node:4" } });
		const out = await resolveRuntimeSidecarUrlAsync(seam, { env: {}, home, cwd });
		expect(out).toEqual({ value: "http://node:4", source: "sovereign-config" });
	});

	it("falls back to the default when nothing resolves", async () => {
		const out = await resolveRuntimeSidecarUrlAsync(noConfig, { env: {}, home, cwd });
		expect(out.source).toBe("default");
		expect(out.value).toBe("http://127.0.0.1:42001");
	});

	it("ignores a malformed sidecarUrl from the seam and uses the default", async () => {
		const seam = async () => ({ runtime: { sidecarUrl: "not-a-url" } });
		const out = await resolveRuntimeSidecarUrlAsync(seam, { env: {}, home, cwd });
		expect(out.source).toBe("default");
	});
});
