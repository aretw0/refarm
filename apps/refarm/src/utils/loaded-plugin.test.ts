import { describe, expect, it } from "vitest";
import { parsePluginArgFromCommandLine, resolveLoadedPlugin } from "./loaded-plugin.js";

describe("parsePluginArgFromCommandLine", () => {
	it("reads the separated form the daemon is actually started with", () => {
		expect(
			parsePluginArgFromCommandLine(["/path/tractor", "--plugin", "/home/op/.refarm/plugins/refarm_agent/plugin.wasm"]),
		).toBe("/home/op/.refarm/plugins/refarm_agent/plugin.wasm");
	});

	it("reads the equals form", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--plugin=/a/b.wasm"])).toBe("/a/b.wasm");
	});

	it("returns undefined when no plugin was named — absent means absent", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--port", "7777"])).toBeUndefined();
	});

	it("returns undefined for a dangling flag rather than swallowing the next argument", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--plugin"])).toBeUndefined();
	});

	it("takes the FIRST occurrence, matching how the host reads its own argv", () => {
		expect(parsePluginArgFromCommandLine(["t", "--plugin", "/first.wasm", "--plugin", "/second.wasm"])).toBe("/first.wasm");
	});
});

describe("resolveLoadedPlugin", () => {
	const deps = {
		readCommandLine: () => ["/t", "--plugin", "/loaded.wasm"],
		hashFile: () => "abc123",
	};

	it("reports the loaded path with its hash", () => {
		expect(resolveLoadedPlugin(42, deps)).toEqual({ path: "/loaded.wasm", sha256: "abc123" });
	});

	it("reports the path with a REASON when the file cannot be hashed — never a silent null", () => {
		const result = resolveLoadedPlugin(42, { ...deps, hashFile: () => null });
		expect(result?.path).toBe("/loaded.wasm");
		expect(result?.sha256).toBeNull();
		expect(result?.unreadableReason).toBeTruthy();
	});

	it("returns null when the process cannot be read at all", () => {
		expect(resolveLoadedPlugin(42, { ...deps, readCommandLine: () => null })).toBeNull();
	});

	it("returns null when the process names no plugin", () => {
		expect(resolveLoadedPlugin(42, { ...deps, readCommandLine: () => ["/t"] })).toBeNull();
	});
});
