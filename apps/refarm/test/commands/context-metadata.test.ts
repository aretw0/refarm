import { describe, expect, it } from "vitest";
import { resolveNodeContextMetadata } from "../../src/utils/context-metadata.js";

describe("resolveNodeContextMetadata", () => {
	it("uses workspace-hatch when REFARM_HOME is the workspace .refarm", () => {
		const cwd = "/tmp/refarm-workspace";
		const metadata = resolveNodeContextMetadata(
			{
				REFARM_HOME: "/tmp/refarm-workspace/.refarm",
				SILO_HOME: "/tmp/refarm-workspace/.refarm",
			} as NodeJS.ProcessEnv,
			cwd,
		);

		expect(metadata.mode).toBe("workspace-hatch");
		expect(metadata.homesAligned).toBe(true);
	});

	it("uses node-global when REFARM_HOME points outside workspace scope", () => {
		const cwd = "/tmp/refarm-workspace";
		const metadata = resolveNodeContextMetadata(
			{
				REFARM_HOME: "/tmp/operator-home/.refarm",
				SILO_HOME: "/tmp/operator-home/.refarm",
			} as NodeJS.ProcessEnv,
			cwd,
		);

		expect(metadata.mode).toBe("node-global");
		expect(metadata.homesAligned).toBe(true);
	});

	it("marks home divergence when silo store differs from runtime home", () => {
		const cwd = "/tmp/refarm-workspace";
		const metadata = resolveNodeContextMetadata(
			{
				REFARM_HOME: "/tmp/operator-home/.refarm",
				SILO_HOME: "/tmp/operator-home/.silo",
			} as NodeJS.ProcessEnv,
			cwd,
		);

		expect(metadata.mode).toBe("node-global");
		expect(metadata.homesAligned).toBe(false);
	});
});
