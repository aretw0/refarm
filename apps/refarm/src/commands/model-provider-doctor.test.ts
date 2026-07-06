import { describe, expect, it } from "vitest";
import {
	DEFAULT_REMOTE_PROFILE,
	providerDoctorProfile,
} from "./model-provider-doctor.js";

describe("providerDoctorProfile", () => {
	it("returns the ollama profile — the keyless local floor", () => {
		const p = providerDoctorProfile("ollama");
		expect(p.keyless).toBe(true);
		expect(p.localRuntime).toBe(true);
		expect(p.startCommand).toBe("ollama serve");
		expect(p.recoveryAction).toContain("Start Ollama");
	});

	it("is case-insensitive and trims", () => {
		expect(providerDoctorProfile("  OLLAMA ").startCommand).toBe("ollama serve");
	});

	it("falls back to the remote default for a keyed provider", () => {
		expect(providerDoctorProfile("openai")).toBe(DEFAULT_REMOTE_PROFILE);
		expect(providerDoctorProfile("anthropic").keyless).toBe(false);
		expect(providerDoctorProfile("anthropic").startCommand).toBeUndefined();
	});

	it("falls back to the remote default for unknown/undefined providers", () => {
		expect(providerDoctorProfile(undefined)).toBe(DEFAULT_REMOTE_PROFILE);
		expect(providerDoctorProfile("")).toBe(DEFAULT_REMOTE_PROFILE);
	});
});
