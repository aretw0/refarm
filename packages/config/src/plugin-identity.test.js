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
	isFsSafeId,
	isCommandSafeId,
	pluginIdRuntimeToken,
	PLUGIN_ID_MAX_LEN,
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
		expect(normalizePluginId("refarm/runtime-agent")).toBe(RUNTIME_AGENT_PLUGIN_ID);
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
		expect(REFARM_BUNDLED_PLUGIN_DESCRIPTORS).toEqual([RUNTIME_AGENT_PLUGIN_DESCRIPTOR]);
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
		expect(canonicalRuntimeAgentContent("normal response")).toBe("normal response");
	});
});

describe("pluginIdToFsToken (filesystem-safe projection)", () => {
	const base = "/home/user/.refarm/plugins";
	const contained = (id) => path.resolve(base, pluginIdToFsToken(id)).startsWith(base + path.sep);

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

describe("plugin-id charset contract (RS↔TS mirror)", () => {
	it("isFsSafeId mirrors the Rust predicate: no @ or /, alnum._- only", () => {
		expect(isFsSafeId("refarm_agent")).toBe(true);
		expect(isFsSafeId("my-plugin.v2")).toBe(true);
		expect(isFsSafeId("@refarm/agent")).toBe(false); // @ and / forbidden
		expect(isFsSafeId("a b")).toBe(false);
		expect(isFsSafeId("a".repeat(PLUGIN_ID_MAX_LEN + 1))).toBe(false); // length
	});

	it("isCommandSafeId permits @ / : (a bare command-line token)", () => {
		expect(isCommandSafeId("agent")).toBe(true);
		expect(isCommandSafeId("@refarm/agent")).toBe(true); // @ / allowed
		expect(isCommandSafeId("a:b")).toBe(true);
		expect(isCommandSafeId("my plugin")).toBe(false); // space needs quoting
		expect(isCommandSafeId("a;rm")).toBe(false);
	});

	it("pluginIdRuntimeToken mirrors Rust manifest_runtime_plugin_id (last segment)", () => {
		expect(pluginIdRuntimeToken("@refarm/agent")).toBe("agent");
		expect(pluginIdRuntimeToken("agent")).toBe("agent");
		expect(pluginIdRuntimeToken("@scope/sub/name")).toBe("name");
		// empty last segment falls back to the whole id (Rust filter(non-empty))
		expect(pluginIdRuntimeToken("@refarm/")).toBe("@refarm/");
	});

	it("the fs flatten and the runtime last-segment are DISTINCT projections", () => {
		// This distinction is load-bearing: Rust keys trust grants on the runtime
		// token, not the fs token. They must never be unified.
		expect(pluginIdToFsToken("@refarm/agent")).toBe("refarm_agent");
		expect(pluginIdRuntimeToken("@refarm/agent")).toBe("agent");
	});
});
