import { describe, expect, it } from "vitest";

import {
	createOperationResult,
	MAX_OPERATION_FINDINGS,
	OPERATION_RESULT_WIRE,
	verifyOperationResult,
} from "./index.js";

describe("operation-result.v1", () => {
	it("projects a useful result without an open output payload", () => {
		const result = createOperationResult({
			status: "issues",
			summary: "One package needs an explicit boundary.",
			metrics: [
				{ name: "packagesScanned", value: 10 },
				{ name: "issueCount", value: 1 },
			],
			findings: [
				{
					code: "missing-boundary-rule",
					summary: "Package has no explicit boundary rule.",
					location: "packages/ovpn-serpro/package.json",
				},
			],
		});
		expect(result.wire).toBe(OPERATION_RESULT_WIRE);
		expect(result.metrics).toHaveLength(2);
		expect(result.findings[0]?.code).toBe("missing-boundary-rule");
		expect(result).not.toHaveProperty("output");
		expect(result).not.toHaveProperty("stdout");
		expect(verifyOperationResult(result)).toBe(true);
	});

	it("redacts secrets and private paths before projection", () => {
		const result = createOperationResult(
			{
				status: "failed",
				summary: "Bearer abc123 failed in /home/operator/private",
				findings: [{ code: "auth", summary: "token abc123", location: "/home/operator/private" }],
			},
			{ knownSecrets: ["abc123"], privatePaths: ["/home/operator/private"] },
		);
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("abc123");
		expect(serialized).not.toContain("/home/operator/private");
		expect(result.redactionCount).toBeGreaterThan(0);
	});

	it("caps findings and records truncation", () => {
		const result = createOperationResult({
			status: "issues",
			summary: "many",
			findings: Array.from({ length: MAX_OPERATION_FINDINGS + 1 }, (_, index) => ({
				code: `finding-${index}`,
				summary: "bounded",
			})),
		});
		expect(result.findings).toHaveLength(MAX_OPERATION_FINDINGS);
		expect(result.truncated).toBe(true);
	});

	it("shrinks verbose findings until the complete UTF-8 envelope fits", () => {
		const result = createOperationResult({
			status: "issues",
			summary: "limite",
			findings: Array.from({ length: MAX_OPERATION_FINDINGS }, (_, index) => ({
				code: `finding-${index}`,
				summary: "🌱".repeat(256),
				location: "á".repeat(512),
			})),
		});
		expect(result.findings.length).toBeLessThan(MAX_OPERATION_FINDINGS);
		expect(result.truncated).toBe(true);
		expect(verifyOperationResult(result)).toBe(true);
	});

	it("refuses non-finite metrics rather than serializing them as null", () => {
		expect(() =>
			createOperationResult({
				status: "failed",
				summary: "invalid metric",
				metrics: [{ name: "duration", value: Number.NaN }],
			}),
		).toThrow(/must be finite/);
	});

	it("rejects malformed and oversized-looking wire values", () => {
		expect(verifyOperationResult({ wire: OPERATION_RESULT_WIRE })).toBe(false);
		expect(
			verifyOperationResult({
				wire: OPERATION_RESULT_WIRE,
				status: "succeeded",
				summary: "x".repeat(513),
				metrics: [],
				findings: [],
				truncated: false,
				redactionCount: 0,
			}),
		).toBe(false);
		expect(
			verifyOperationResult({
				...createOperationResult({ status: "succeeded", summary: "ok" }),
				stdout: "must never cross this contract",
			}),
		).toBe(false);
	});
});
