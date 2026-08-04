import { describe, expect, it } from "vitest";
import { resolveNodeContextMetadata } from "../../src/utils/context-metadata.js";

describe("resolveNodeContextMetadata", () => {
	it("uses workspace mode when REFARM_HOME is the workspace .refarm", () => {
		const cwd = "/tmp/refarm-workspace";
		const metadata = resolveNodeContextMetadata(
			{
				REFARM_HOME: "/tmp/refarm-workspace/.refarm",
				SILO_HOME: "/tmp/refarm-workspace/.refarm",
			} as NodeJS.ProcessEnv,
			cwd,
		);

		expect(metadata.mode).toBe("workspace");
		expect(metadata.binding.kind).toBe("attached");
		expect(metadata.binding.origin).toBe("explicit");
		expect(metadata.state.policy).toBe("workspace-owned");
		expect(metadata.homesAligned).toBe(true);
	});

	it("uses node mode when REFARM_HOME points outside workspace scope", () => {
		const cwd = "/tmp/refarm-workspace";
		const metadata = resolveNodeContextMetadata(
			{
				REFARM_HOME: "/tmp/operator-home/.refarm",
				SILO_HOME: "/tmp/operator-home/.refarm",
			} as NodeJS.ProcessEnv,
			cwd,
		);

		expect(metadata.mode).toBe("node");
		expect(metadata.binding.kind).toBe("detached");
		expect(metadata.binding.origin).toBe("explicit");
		expect(metadata.state.policy).toBe("node-owned");
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

		expect(metadata.mode).toBe("node");
		expect(metadata.homesAligned).toBe(false);
	});

	it("marks origin as default when REFARM_HOME is not explicitly set", () => {
		const cwd = "/tmp/refarm-workspace";
		const metadata = resolveNodeContextMetadata({} as NodeJS.ProcessEnv, cwd);

		expect(metadata.binding.origin).toBe("default");
	});
});
