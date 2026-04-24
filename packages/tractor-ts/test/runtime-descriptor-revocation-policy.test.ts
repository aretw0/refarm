import { describe, expect, it } from "vitest";
import {
	getRuntimeDescriptorRevocationPolicyForProfile,
	normalizeRuntimeDescriptorRevocationProfile,
	normalizeRuntimeDescriptorRevocationUnavailablePolicy,
	resolveRuntimeDescriptorRevocationUnavailablePolicy,
} from "../src/lib/runtime-descriptor-revocation-policy";

describe("runtime-descriptor-revocation-policy", () => {
	it("normalizes revocation unavailable policies", () => {
		expect(
			normalizeRuntimeDescriptorRevocationUnavailablePolicy("fail-open"),
		).toBe("fail-open");
		expect(
			normalizeRuntimeDescriptorRevocationUnavailablePolicy("stale-allowed"),
		).toBe("stale-allowed");
		expect(
			normalizeRuntimeDescriptorRevocationUnavailablePolicy("FAIL-CLOSED"),
		).toBe("fail-closed");
		expect(
			normalizeRuntimeDescriptorRevocationUnavailablePolicy("unknown"),
		).toBeNull();
	});

	it("normalizes revocation profiles with aliases", () => {
		expect(normalizeRuntimeDescriptorRevocationProfile("local")).toBe("dev");
		expect(normalizeRuntimeDescriptorRevocationProfile("development")).toBe(
			"dev",
		);
		expect(normalizeRuntimeDescriptorRevocationProfile("staging")).toBe(
			"staging",
		);
		expect(normalizeRuntimeDescriptorRevocationProfile("preprod")).toBe(
			"staging",
		);
		expect(normalizeRuntimeDescriptorRevocationProfile("production")).toBe(
			"production-sensitive",
		);
		expect(normalizeRuntimeDescriptorRevocationProfile("sensitive-prod")).toBe(
			"production-sensitive",
		);
		expect(normalizeRuntimeDescriptorRevocationProfile("random")).toBeNull();
	});

	it("maps profiles to expected policies", () => {
		expect(getRuntimeDescriptorRevocationPolicyForProfile("dev")).toBe(
			"fail-open",
		);
		expect(getRuntimeDescriptorRevocationPolicyForProfile("staging")).toBe(
			"stale-allowed",
		);
		expect(
			getRuntimeDescriptorRevocationPolicyForProfile("production-sensitive"),
		).toBe("fail-closed");
	});

	it("resolves policy precedence: explicit policy > explicit profile > env policy > env profile > fallback", () => {
		expect(
			resolveRuntimeDescriptorRevocationUnavailablePolicy({
				explicitPolicy: "fail-open",
				explicitProfile: "production-sensitive",
				environmentPolicy: "fail-closed",
				environmentProfile: "staging",
				fallbackPolicy: "stale-allowed",
			}),
		).toEqual({
			policy: "fail-open",
			source: "explicit-policy",
		});

		expect(
			resolveRuntimeDescriptorRevocationUnavailablePolicy({
				explicitProfile: "production-sensitive",
				environmentPolicy: "fail-open",
				environmentProfile: "dev",
				fallbackPolicy: "stale-allowed",
			}),
		).toEqual({
			policy: "fail-closed",
			source: "explicit-profile",
			profile: "production-sensitive",
		});

		expect(
			resolveRuntimeDescriptorRevocationUnavailablePolicy({
				environmentPolicy: "fail-open",
				environmentProfile: "production-sensitive",
				fallbackPolicy: "stale-allowed",
			}),
		).toEqual({
			policy: "fail-open",
			source: "environment-policy",
		});

		expect(
			resolveRuntimeDescriptorRevocationUnavailablePolicy({
				environmentProfile: "staging",
				fallbackPolicy: "fail-closed",
			}),
		).toEqual({
			policy: "stale-allowed",
			source: "environment-profile",
			profile: "staging",
		});

		expect(
			resolveRuntimeDescriptorRevocationUnavailablePolicy({
				fallbackPolicy: "fail-closed",
			}),
		).toEqual({
			policy: "fail-closed",
			source: "fallback",
		});
	});
});
