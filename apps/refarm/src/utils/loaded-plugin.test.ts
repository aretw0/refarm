import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultHashFile, parsePluginArgFromCommandLine, parseProcCommandLine, resolveLoadedPlugin } from "./loaded-plugin.js";

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

	it("returns undefined for --plugin= with empty value", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--plugin="])).toBeUndefined();
	});

	it("returns undefined when --plugin is immediately followed by another flag", () => {
		expect(parsePluginArgFromCommandLine(["/path/tractor", "--plugin", "--port"])).toBeUndefined();
	});

	it("takes the FIRST occurrence, matching how the host reads its own argv", () => {
		expect(parsePluginArgFromCommandLine(["t", "--plugin", "/first.wasm", "--plugin", "/second.wasm"])).toBe("/first.wasm");
	});
});

describe("parseProcCommandLine", () => {
	it("parses NUL-separated argv from /proc/<pid>/cmdline", () => {
		const raw = "/path/tractor\0--plugin\0/home/op/.refarm/plugins/refarm_agent/plugin.wasm\0";
		expect(parseProcCommandLine(raw)).toEqual(["/path/tractor", "--plugin", "/home/op/.refarm/plugins/refarm_agent/plugin.wasm"]);
	});

	it("handles a single argument", () => {
		const raw = "/path/tractor\0";
		expect(parseProcCommandLine(raw)).toEqual(["/path/tractor"]);
	});

	it("returns null for empty string", () => {
		expect(parseProcCommandLine("")).toBeNull();
	});

	it("preserves interior empty arguments", () => {
		const raw = "/path/prog\0\0--flag\0";
		const result = parseProcCommandLine(raw);
		expect(result).toEqual(["/path/prog", "", "--flag"]);
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

describe("defaultHashFile", () => {
	it("hashes a file with known content to the correct SHA-256", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "loaded-plugin-"));
		try {
			const testFile = join(tmpDir, "test.wasm");
			const content = "test content";
			writeFileSync(testFile, content);
			const expectedHash = createHash("sha256").update(content).digest("hex");
			expect(defaultHashFile(testFile)).toBe(expectedHash);
		} finally {
			rmSync(tmpDir, { recursive: true });
		}
	});

	it("returns null for a nonexistent file instead of throwing", () => {
		expect(defaultHashFile("/nonexistent/path/to/file.wasm")).toBeNull();
	});
});

describe("defaultHashFile through resolveLoadedPlugin", () => {
	it("uses the real hasher when only readCommandLine is stubbed", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "loaded-plugin-"));
		try {
			const testFile = join(tmpDir, "plugin.wasm");
			const content = "plugin bytes";
			writeFileSync(testFile, content);
			const expectedHash = createHash("sha256").update(content).digest("hex");

			const result = resolveLoadedPlugin(42, {
				readCommandLine: () => ["/t", "--plugin", testFile],
			});

			expect(result).toBeTruthy();
			expect(result?.path).toBe(testFile);
			expect(result?.sha256).toBe(expectedHash);
		} finally {
			rmSync(tmpDir, { recursive: true });
		}
	});

	it("reports unreadableReason when the plugin file cannot be read", () => {
		const result = resolveLoadedPlugin(42, {
			readCommandLine: () => ["/t", "--plugin", "/nonexistent/plugin.wasm"],
		});

		expect(result).toBeTruthy();
		expect(result?.path).toBe("/nonexistent/plugin.wasm");
		expect(result?.sha256).toBeNull();
		expect(result?.unreadableReason).toBeTruthy();
	});
});
