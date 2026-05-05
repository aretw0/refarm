import { describe, expect, it } from "vitest";
import {
	dedupeRuntimeDescriptorRevocationConfigConflicts,
	dedupeRuntimeDescriptorRevocationInvalidInputs,
	getRuntimeDescriptorRevocationPolicyForProfile,
	normalizeRuntimeDescriptorRevocationEnvironmentName,
	normalizeRuntimeDescriptorRevocationProfile,
	normalizeRuntimeDescriptorRevocationUnavailablePolicy,
	resolveRuntimeDescriptorRevocationEnvironmentProfile,
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

	it("normalizes generic environment names to revocation profiles", () => {
		expect(normalizeRuntimeDescriptorRevocationEnvironmentName("development")).toBe(
			"dev",
		);
		expect(normalizeRuntimeDescriptorRevocationEnvironmentName("testing")).toBe(
			"dev",
		);
		expect(normalizeRuntimeDescriptorRevocationEnvironmentName("preview")).toBe(
			"staging",
		);
		expect(normalizeRuntimeDescriptorRevocationEnvironmentName("production")).toBe(
			"production-sensitive",
		);
		expect(normalizeRuntimeDescriptorRevocationEnvironmentName("live")).toBe(
			"production-sensitive",
		);
		expect(normalizeRuntimeDescriptorRevocationEnvironmentName("unknown")).toBeNull();
	});

	it("resolves environment profile preferring dedicated profile over generic environment", () => {
		expect(
			resolveRuntimeDescriptorRevocationEnvironmentProfile({
				dedicatedProfile: "staging",
				genericEnvironment: "production",
			}),
		).toEqual({
			profile: "staging",
			source: "dedicated-profile",
			conflicts: [
				{
					slot: "environment-profile",
					preferredSource: "dedicated-profile",
					preferredValue: "staging",
					preferredProfile: "staging",
					ignoredSource: "generic-environment",
					ignoredValue: "production",
					ignoredProfile: "production-sensitive",
				},
			],
		});

		expect(
			resolveRuntimeDescriptorRevocationEnvironmentProfile({
				dedicatedProfile: "invalid-profile",
				genericEnvironment: "production",
			}),
		).toEqual({
			profile: "production-sensitive",
			source: "generic-environment",
			invalidInputs: [
				{ slot: "environment-profile", value: "invalid-profile" },
			],
		});

		expect(
			resolveRuntimeDescriptorRevocationEnvironmentProfile({
				dedicatedProfile: "invalid-profile",
				genericEnvironment: "invalid-env",
			}),
		).toEqual({
			invalidInputs: [
				{ slot: "environment-profile", value: "invalid-profile" },
				{ slot: "environment-profile", value: "invalid-env" },
			],
		});

		expect(
			resolveRuntimeDescriptorRevocationEnvironmentProfile({
				dedicatedProfile: "dev",
				genericEnvironment: "test",
			}),
		).toEqual({
			profile: "dev",
			source: "dedicated-profile",
		});
	});

	it("dedupes invalid inputs and conflict entries", () => {
		expect(
			dedupeRuntimeDescriptorRevocationInvalidInputs([
				{ slot: "environment-profile", value: "prod" },
				{ slot: "environment-profile", value: "prod" },
			]),
		).toEqual([{ slot: "environment-profile", value: "prod" }]);

		expect(
			dedupeRuntimeDescriptorRevocationConfigConflicts([
				{
					slot: "environment-profile",
					preferredSource: "dedicated-profile",
					preferredValue: "dev",
					preferredProfile: "dev",
					ignoredSource: "generic-environment",
					ignoredValue: "production",
					ignoredProfile: "production-sensitive",
				},
				{
					slot: "environment-profile",
					preferredSource: "dedicated-profile",
					preferredValue: "dev",
					preferredProfile: "dev",
					ignoredSource: "generic-environment",
					ignoredValue: "production",
					ignoredProfile: "production-sensitive",
				},
			]),
		).toHaveLength(1);
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

	it("reports invalid inputs while still resolving with deterministic precedence", () => {
		expect(
			resolveRuntimeDescriptorRevocationUnavailablePolicy({
				explicitPolicy: "not-a-policy",
				explicitProfile: "dev",
				environmentPolicy: "also-invalid",
				environmentProfile: "qa",
				fallbackPolicy: "fail-closed",
			}),
		).toEqual({
			policy: "fail-open",
			source: "explicit-profile",
			profile: "dev",
			invalidInputs: [
				{ slot: "explicit-policy", value: "not-a-policy" },
				{ slot: "environment-policy", value: "also-invalid" },
			],
		});

		expect(
			resolveRuntimeDescriptorRevocationUnavailablePolicy({
				environmentProfile: "invalid-profile",
				fallbackPolicy: "stale-allowed",
			}),
		).toEqual({
			policy: "stale-allowed",
			source: "fallback",
			invalidInputs: [
				{ slot: "environment-profile", value: "invalid-profile" },
			],
		});
	});
});
