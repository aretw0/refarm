import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	AGENT_NPM_PACKAGE,
	AGENT_PLUGIN_ID,
	REFARM_BUNDLED_PLUGIN_DESCRIPTORS,
	RUNTIME_AGENT_NPM_PACKAGE,
	RUNTIME_AGENT_PLUGIN_DESCRIPTOR,
	RUNTIME_AGENT_PLUGIN_ID,
	canonicalRuntimeAgentContent,
	isRuntimeAgentErrorContent,
	isAgentPluginId,
	isRuntimeAgentPluginId,
	normalizePluginId,
	pluginIdToFsToken,
} from "./plugin-identity.js";

describe("plugin identity", () => {
	it("normalizes agent aliases to the manifest plugin id", () => {
		expect(normalizePluginId("agent")).toBe(AGENT_PLUGIN_ID);
		expect(normalizePluginId("refarm/agent")).toBe(AGENT_PLUGIN_ID);
		expect(normalizePluginId(AGENT_NPM_PACKAGE)).toBe(AGENT_PLUGIN_ID);
		expect(normalizePluginId(AGENT_PLUGIN_ID)).toBe(AGENT_PLUGIN_ID);
	});

	it("leaves other plugin ids unchanged", () => {
		expect(normalizePluginId("@local/tool")).toBe("@local/tool");
	});

	it("detects agent aliases", () => {
		expect(isAgentPluginId("agent")).toBe(true);
		expect(isAgentPluginId(AGENT_NPM_PACKAGE)).toBe(true);
		expect(isAgentPluginId("@local/tool")).toBe(false);
	});

	it("exposes runtime-agent aliases for new call sites", () => {
		expect(RUNTIME_AGENT_PLUGIN_ID).toBe(AGENT_PLUGIN_ID);
		expect(RUNTIME_AGENT_NPM_PACKAGE).toBe(AGENT_NPM_PACKAGE);
		expect(normalizePluginId("agent")).toBe(RUNTIME_AGENT_PLUGIN_ID);
		expect(normalizePluginId("refarm/agent")).toBe(RUNTIME_AGENT_PLUGIN_ID);
		expect(normalizePluginId("runtime-agent")).toBe(RUNTIME_AGENT_PLUGIN_ID);
		expect(normalizePluginId("runtime_agent")).toBe(RUNTIME_AGENT_PLUGIN_ID);
		expect(normalizePluginId("refarm/runtime-agent")).toBe(
			RUNTIME_AGENT_PLUGIN_ID,
		);
		expect(isRuntimeAgentPluginId("agent")).toBe(true);
		expect(isRuntimeAgentPluginId("runtime-agent")).toBe(true);
		expect(isRuntimeAgentPluginId("@local/tool")).toBe(false);
	});

	it("exposes the runtime agent as an official bundled plugin descriptor", () => {
		expect(RUNTIME_AGENT_PLUGIN_DESCRIPTOR).toEqual({
			id: RUNTIME_AGENT_PLUGIN_ID,
			npmPackage: RUNTIME_AGENT_NPM_PACKAGE,
			workspaceDir: "packages/agent",
			wasmFile: "dist/agent.wasm",
			manifestFile: "dist/plugin.json",
			requiredProvides: ["integration:respond"],
		});
		expect(REFARM_BUNDLED_PLUGIN_DESCRIPTORS).toEqual([
			RUNTIME_AGENT_PLUGIN_DESCRIPTOR,
		]);
	});

	it("detects runtime agent error-like content", () => {
		expect(isRuntimeAgentErrorContent("[runtime-agent error] quota")).toBe(true);
		expect(isRuntimeAgentErrorContent("[runtime-agent stub] no model")).toBe(true);
		expect(isRuntimeAgentErrorContent("[budget] limit reached")).toBe(true);
		expect(isRuntimeAgentErrorContent("normal response")).toBe(false);
	});

	it("passes runtime-agent content through unchanged (legacy pi-agent translation dropped)", () => {
		// The pi-agent generation is gone (fresh store), so there is no legacy label
		// to canonicalize — content already uses the runtime-agent labels.
		expect(canonicalRuntimeAgentContent("[runtime-agent error] quota")).toBe(
			"[runtime-agent error] quota",
		);
		expect(canonicalRuntimeAgentContent("normal response")).toBe(
			"normal response",
		);
	});
});

describe("pluginIdToFsToken (filesystem-safe projection)", () => {
	const base = "/home/user/.refarm/plugins";
	const contained = (id) =>
		path.resolve(base, pluginIdToFsToken(id)).startsWith(base + path.sep);

	it("flattens a scoped id to one legible segment", () => {
		expect(pluginIdToFsToken("@refarm/agent")).toBe("refarm_agent");
		expect(pluginIdToFsToken("vault")).toBe("vault");
		expect(pluginIdToFsToken("my-plugin.v2")).toBe("my-plugin.v2");
	});

	it("contains a path-traversal id inside the base dir", () => {
		// Raw, `@a/../../etc/passwd` resolves two levels ABOVE base.
		expect(pluginIdToFsToken("@a/../../etc/passwd")).toBe("a_.._.._etc_passwd");
		expect(contained("@a/../../etc/passwd")).toBe(true);
	});

	it("neutralizes bare `.` / `..` that would otherwise navigate", () => {
		expect(pluginIdToFsToken("..")).toBe("_..");
		expect(pluginIdToFsToken(".")).toBe("_.");
		expect(contained("..")).toBe(true);
		expect(contained(".")).toBe(true);
	});

	it("flattens Windows backslash separators", () => {
		expect(pluginIdToFsToken("a\\b")).toBe("a_b");
		expect(contained("..\\..\\x")).toBe(true);
	});

	it("collapses shell metacharacters and whitespace", () => {
		expect(pluginIdToFsToken("a;rm -rf/")).toBe("a_rm_-rf_");
		expect(pluginIdToFsToken("a'b\"c")).toBe("a_b_c");
		expect(pluginIdToFsToken("a b")).toBe("a_b");
	});

	it("is idempotent on an already-safe token", () => {
		const once = pluginIdToFsToken("@refarm/agent");
		expect(pluginIdToFsToken(once)).toBe(once);
	});
});
