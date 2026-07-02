import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runSourceV1Conformance } from "@refarm.dev/source-contract-v1";
import { createWebSourceProvider } from "./index.js";

async function cacheRoot(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "source-web-"));
}

describe("source-web provider", () => {
	it("passes source:v1 conformance as a local snapshot adapter", async () => {
		const provider = createWebSourceProvider({ cacheRoot: await cacheRoot() });
		const result = await runSourceV1Conformance(provider, "web:requirements-fixture");
		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("materializes sanitized fixture content with session/cache provenance", async () => {
		const provider = createWebSourceProvider({ cacheRoot: await cacheRoot() });
		const result = await provider.materialize("web:requirements-fixture", { offline: true });

		expect(result.location.kind).toBe("local");
		expect(result.action).toBe("cloned");
		expect(result.web.session.authenticated).toBe(true);
		expect(result.web.session.credentialRef).toBe("silo://fixture/web-session");
		expect(result.web.pacing.maxRequestsPerMinute).toBe(12);
		expect(result.web.cache.offlineReplay).toBe(true);
		expect(result.web.cache.hash).toMatch(/^sha256:/);
		expect(result.web.egress).toEqual({
			enforced: true,
			allowed: true,
			refKind: "fixture",
			host: null,
			policy: {
				allowedHosts: ["example.invalid"],
				blockPrivateHosts: true,
			},
		});
		expect(result.web.redaction).toEqual({
			applied: true,
			fields: ["cookie", "authorization", "set-cookie"],
		});

		const content = await readFile(path.join(result.location.path, "content.html"), "utf8");
		expect(content).toContain("REQ-1");
		expect(content).not.toMatch(/cookie|authorization|set-cookie/i);

		const status = await provider.status("web:requirements-fixture");
		expect(status.materialized).toBe(true);
		expect(status.kind).toBe("local");
		expect(status.clean).toBe(true);
		expect(status.dirty).toBe(false);
		expect(status.head).toBe(result.web.cache.hash);
	});

	it("keeps source-specific URLs and selectors outside the default fixture", async () => {
		const provider = createWebSourceProvider({ cacheRoot: await cacheRoot() });
		await provider.materialize("web:requirements-fixture");
		const provenance = await provider.snapshotProvenance("web:requirements-fixture");

		expect(provenance?.session.kind).toBe("fixture");
		expect(JSON.stringify(provenance)).not.toMatch(/selector|password|token/i);
	});

	it("requires an egress allowlist for http fixture refs", async () => {
		const provider = createWebSourceProvider({ cacheRoot: await cacheRoot() });

		await expect(provider.resolve("https://docs.example/refarm/requirements")).rejects.toThrow(
			/EGRESS_DENIED/,
		);
	});

	it("records allowed http fixture egress provenance", async () => {
		const provider = createWebSourceProvider({
			cacheRoot: await cacheRoot(),
			egress: {
				allowedHosts: ["docs.example"],
			},
		});

		const result = await provider.materialize("https://docs.example/refarm/requirements", { offline: true });

		expect(result.web.egress).toEqual({
			enforced: true,
			allowed: true,
			refKind: "http",
			host: "docs.example",
			policy: {
				allowedHosts: ["docs.example"],
				blockPrivateHosts: true,
			},
		});
	});

	it("blocks private hosts even when they are allowlisted by name", async () => {
		const provider = createWebSourceProvider({
			cacheRoot: await cacheRoot(),
			egress: {
				allowedHosts: ["localhost"],
			},
		});

		await expect(provider.materialize("http://localhost/private")).rejects.toThrow(
			/EGRESS_DENIED: source-web blocks private host/,
		);
	});
});
