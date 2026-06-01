import { describe, expect, it } from "vitest";
import {
	PI_AGENT_NPM_PACKAGE,
	PI_AGENT_PLUGIN_ID,
	isPiAgentPluginId,
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
});
