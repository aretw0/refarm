import { describe, expect, it } from "vitest";
import {
	PI_AGENT_NPM_PACKAGE,
	PI_AGENT_PLUGIN_ID,
	RUNTIME_AGENT_NPM_PACKAGE,
	RUNTIME_AGENT_PLUGIN_ID,
	isRuntimeAgentErrorContent,
	isPiAgentPluginId,
	isRuntimeAgentPluginId,
	normalizePluginId,
} from "./plugin-identity.js";

describe("plugin identity", () => {
	it("normalizes pi-agent aliases to the manifest plugin id", () => {
		expect(normalizePluginId("pi-agent")).toBe(PI_AGENT_PLUGIN_ID);
		expect(normalizePluginId("pi_agent")).toBe(PI_AGENT_PLUGIN_ID);
		expect(normalizePluginId("refarm/pi-agent")).toBe(PI_AGENT_PLUGIN_ID);
		expect(normalizePluginId(PI_AGENT_NPM_PACKAGE)).toBe(PI_AGENT_PLUGIN_ID);
		expect(normalizePluginId(PI_AGENT_PLUGIN_ID)).toBe(PI_AGENT_PLUGIN_ID);
	});

	it("leaves other plugin ids unchanged", () => {
		expect(normalizePluginId("@local/tool")).toBe("@local/tool");
	});

	it("detects pi-agent aliases", () => {
		expect(isPiAgentPluginId("pi-agent")).toBe(true);
		expect(isPiAgentPluginId("pi_agent")).toBe(true);
		expect(isPiAgentPluginId(PI_AGENT_NPM_PACKAGE)).toBe(true);
		expect(isPiAgentPluginId("@local/tool")).toBe(false);
	});

	it("exposes runtime-agent aliases for new call sites", () => {
		expect(RUNTIME_AGENT_PLUGIN_ID).toBe(PI_AGENT_PLUGIN_ID);
		expect(RUNTIME_AGENT_NPM_PACKAGE).toBe(PI_AGENT_NPM_PACKAGE);
		expect(normalizePluginId("runtime-agent")).toBe(RUNTIME_AGENT_PLUGIN_ID);
		expect(normalizePluginId("runtime_agent")).toBe(RUNTIME_AGENT_PLUGIN_ID);
		expect(normalizePluginId("refarm/runtime-agent")).toBe(
			RUNTIME_AGENT_PLUGIN_ID,
		);
		expect(isRuntimeAgentPluginId("pi-agent")).toBe(true);
		expect(isRuntimeAgentPluginId("runtime-agent")).toBe(true);
		expect(isRuntimeAgentPluginId("@local/tool")).toBe(false);
	});

	it("detects runtime agent error-like content, including legacy prefixes", () => {
		expect(isRuntimeAgentErrorContent("[runtime-agent error] quota")).toBe(true);
		expect(isRuntimeAgentErrorContent("[runtime-agent stub] no model")).toBe(true);
		expect(isRuntimeAgentErrorContent("[budget] limit reached")).toBe(true);
		expect(isRuntimeAgentErrorContent("[pi-agent erro] quota")).toBe(true);
		expect(isRuntimeAgentErrorContent("normal response")).toBe(false);
	});
});
