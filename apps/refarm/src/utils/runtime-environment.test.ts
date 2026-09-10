import { describe, expect, it } from "vitest";
import { resolveRuntimeEnvironment } from "./runtime-environment.js";

const environ = (...keys: string[]) => keys.map((k) => `${k}=value`).join("\0");
const pid = { pid: 1596456 };

describe("runtime environment", () => {
	it("is configured when the running node carries a provider", () => {
		const result = resolveRuntimeEnvironment(pid, "openai-codex", {
			readEnviron: () => environ("PATH", "MODEL_PROVIDER", "MODEL_ID", "MODEL_CONFIGURED_PROVIDERS"),
		});
		expect(result.state).toBe("configured");
		expect(result.modelKeys).toEqual(["MODEL_CONFIGURED_PROVIDERS", "MODEL_ID", "MODEL_PROVIDER"]);
	});

	it("reports the 2026-08-05 incident: a bare node while the config declares a provider", () => {
		// The node came up, answered its endpoints, reported healthy, and failed minutes later
		// with a provider mismatch that named the symptom and not the cause.
		const result = resolveRuntimeEnvironment(pid, "openai-codex", {
			readEnviron: () => environ("PATH", "HOME"),
		});
		expect(result.state).toBe("bare");
		expect(result.reason).toContain("openai-codex");
		expect(result.reason).toMatch(/keyless local floor/);
	});

	it("is not a finding when the config declares no provider either", () => {
		// Falling to the local floor is then exactly what was asked for, and warning about it
		// would cry wolf on every keyless install.
		const result = resolveRuntimeEnvironment(pid, undefined, {
			readEnviron: () => environ("PATH"),
		});
		expect(result.state).toBe("configured");
	});

	it("never reports a value, only key names", () => {
		// Several of these hold credentials materialised out of the sovereign vault. A
		// diagnostic that printed them would be a worse defect than the one it reports.
		const result = resolveRuntimeEnvironment(pid, "anthropic", {
			readEnviron: () => "MODEL_PROVIDER=anthropic\0MODEL_API_KEY=sk-super-secret",
		});
		expect(JSON.stringify(result)).not.toContain("sk-super-secret");
		expect(result.modelKeys).toContain("MODEL_API_KEY");
	});

	it("says unknown when the node does not say which process it is", () => {
		expect(resolveRuntimeEnvironment(null, "anthropic").state).toBe("unknown");
	});

	it("says unknown when the environment cannot be read, never configured", () => {
		const result = resolveRuntimeEnvironment(pid, "anthropic", { readEnviron: () => null });
		expect(result.state).toBe("unknown");
		expect(result.reason).toMatch(/could not be read/);
	});
});
