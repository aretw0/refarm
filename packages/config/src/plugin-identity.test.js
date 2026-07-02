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
			requiredProvides: ["agent:respond"],
		});
		expect(REFARM_BUNDLED_PLUGIN_DESCRIPTORS).toEqual([
			RUNTIME_AGENT_PLUGIN_DESCRIPTOR,
		]);
	});

	it("detects runtime agent error-like content, including legacy prefixes", () => {
		expect(isRuntimeAgentErrorContent("[runtime-agent error] quota")).toBe(true);
		expect(isRuntimeAgentErrorContent("[runtime-agent stub] no model")).toBe(true);
		expect(isRuntimeAgentErrorContent("[budget] limit reached")).toBe(true);
		expect(isRuntimeAgentErrorContent("[pi-agent erro] quota")).toBe(true);
		expect(isRuntimeAgentErrorContent("normal response")).toBe(false);
	});

	it("canonicalizes legacy runtime agent content prefixes for display", () => {
		expect(canonicalRuntimeAgentContent("[pi-agent erro] quota")).toBe(
			"[runtime-agent error] quota",
		);
		expect(canonicalRuntimeAgentContent("[pi-agent stub] no model")).toBe(
			"[runtime-agent stub] no model",
		);
		expect(canonicalRuntimeAgentContent("[runtime-agent error] quota")).toBe(
			"[runtime-agent error] quota",
		);
		expect(canonicalRuntimeAgentContent("normal response")).toBe(
			"normal response",
		);
	});
});
