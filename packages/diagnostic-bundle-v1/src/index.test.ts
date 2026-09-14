import { describe, expect, it } from "vitest";
import {
	createDiagnosticBundle,
	DIAGNOSTIC_BUNDLE_WIRE,
	REDACTED,
	verifyDiagnosticBundle,
} from "./index.js";

const SECRET = "device-secret-123456";

describe("diagnostic-bundle.v1", () => {
	it("builds a deterministic, versioned bundle from structured sections", () => {
		const input = {
			createdAt: "2026-08-02T04:00:00.000Z",
			producer: { name: "refarm", version: "0.1.0" },
			sections: [{ id: "runtime", source: "refarm", data: { ready: true } }],
		};
		expect(createDiagnosticBundle(input)).toEqual(createDiagnosticBundle(input));
		expect(createDiagnosticBundle(input).wire).toBe(DIAGNOSTIC_BUNDLE_WIRE);
	});

	it("redacts sensitive keys recursively without needing to know their values", () => {
		const bundle = createDiagnosticBundle({
			createdAt: "2026-08-02T04:00:00.000Z",
			producer: { name: "plugin", version: "1" },
			sections: [
				{ id: "plugin", source: "example", data: { nested: { accessToken: SECRET, safe: "ok" } } },
			],
		});
		expect(JSON.stringify(bundle)).not.toContain(SECRET);
		expect((bundle.sections[0]?.data as { nested: { accessToken: string } }).nested.accessToken).toBe(
			REDACTED,
		);
	});

	it("scrubs known secrets, bearer values, credentialed URLs, private keys, and private paths", () => {
		const bundle = createDiagnosticBundle(
			{
				createdAt: "2026-08-02T04:00:00.000Z",
				producer: { name: "refarm", version: "1" },
				sections: [
					{
						id: "errors",
						source: "host",
						data: {
							detail: `failed Bearer abc.DEF ${SECRET} at /home/alice/private`,
							url: "https://alice:hunter2@example.test/path",
							pem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
						},
					},
				],
			},
			{ knownSecrets: [SECRET], privatePaths: ["/home/alice"] },
		);
		const serialized = JSON.stringify(bundle);
		for (const forbidden of [SECRET, "abc.DEF", "hunter2", "/home/alice", "BEGIN PRIVATE KEY"]) {
			expect(serialized).not.toContain(forbidden);
		}
		expect(bundle.redaction.count).toBeGreaterThanOrEqual(5);
		expect(verifyDiagnosticBundle(bundle, { knownSecrets: [SECRET], privatePaths: ["/home/alice"] })).toEqual(
			{ ok: true, issues: [] },
		);
	});

	it("refuses an unsupported wire and detects a secret reintroduced after construction", () => {
		expect(verifyDiagnosticBundle({ wire: "other" }).ok).toBe(false);
		const bundle = createDiagnosticBundle({
			createdAt: "2026-08-02T04:00:00.000Z",
			producer: { name: "refarm", version: "1" },
			sections: [],
		});
		(bundle.sections as unknown[]).push({ id: "bad", source: "test", data: SECRET });
		expect(verifyDiagnosticBundle(bundle, { knownSecrets: [SECRET] })).toEqual({
			ok: false,
			issues: ["known secret remains in bundle"],
		});
	});
});
