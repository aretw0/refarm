import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	MODEL_RATE_CATALOG_FILE_NAME,
	materializeDefaultModelRateCatalog,
	modelRateCatalogPath,
} from "../../src/commands/model-rate-catalog.js";

/**
 * The host has NO compiled-in catalog. If this materialisation stops working the daemon
 * injects nothing and every run prices from the agent's built-in table instead of the
 * audited artifact — silently, because falling back is the correct behaviour for an absent
 * catalog. So the tests below are the only thing standing between "the artifact reaches the
 * runtime" and "it quietly stopped".
 */

const created: string[] = [];

function sandbox(): NodeJS.ProcessEnv {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-catalog-"));
	created.push(home);
	return { REFARM_HOME: home };
}

afterEach(() => {
	for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("materializeDefaultModelRateCatalog", () => {
	it("writes the shipped artifact where the host looks for it", () => {
		const env = sandbox();
		const result = materializeDefaultModelRateCatalog(env);

		expect(result.status).toBe("materialized");
		expect(result.path).toBe(path.join(env.REFARM_HOME!, MODEL_RATE_CATALOG_FILE_NAME));
		expect(result.path).toBe(modelRateCatalogPath(env));

		// The bytes must be the audited artifact, not a re-serialisation of it: the Rust
		// host validates what it reads with the same rules the package enforces, and a
		// reshaped file is a second source.
		const written = fs.readFileSync(result.path, "utf-8");
		const shipped = fs.readFileSync(
			path.resolve(
				import.meta.dirname,
				"../../../../packages/model-catalog-v1/catalog",
				MODEL_RATE_CATALOG_FILE_NAME,
			),
			"utf-8",
		);
		expect(written).toBe(shipped);

		const catalog = JSON.parse(written) as { schemaVersion: string; entries: unknown[] };
		expect(catalog.schemaVersion).toBe("model-rate-catalog.v1");
		expect(catalog.entries.length).toBeGreaterThan(0);
	});

	it("is idempotent: a second call reports kept and writes nothing", () => {
		const env = sandbox();
		const first = materializeDefaultModelRateCatalog(env);
		expect(first.status).toBe("materialized");
		const stamp = fs.statSync(first.path).mtimeMs;

		const second = materializeDefaultModelRateCatalog(env);
		expect(second.status).toBe("kept");
		expect(second.path).toBe(first.path);
		expect(fs.statSync(first.path).mtimeMs).toBe(stamp);
	});

	it("NEVER overwrites a catalog the node edited — a corrected rate survives restarts", () => {
		const env = sandbox();
		const target = modelRateCatalogPath(env);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		// What a node that negotiated its own rate actually puts there.
		const corrected = JSON.stringify({
			schemaVersion: "model-rate-catalog.v1",
			catalogVersion: "node-local.1",
			entries: [
				{
					provider: "anthropic",
					match: { mode: "contains", value: "claude-sonnet-5" },
					rate: { inputPerMTokenUsd: 1.5, outputPerMTokenUsd: 7 },
					pricingUrl: "https://example.invalid/negotiated",
					verifiedAt: "2026-08-04",
				},
			],
		});
		fs.writeFileSync(target, corrected);

		// Every restart runs this pass again. Every restart must leave the file alone.
		for (let restart = 0; restart < 3; restart += 1) {
			expect(materializeDefaultModelRateCatalog(env).status).toBe("kept");
			expect(fs.readFileSync(target, "utf-8")).toBe(corrected);
		}
	});

	it("creates the sovereign dir when it does not exist yet", () => {
		const env = sandbox();
		const home = path.join(env.REFARM_HOME!, "nested", "never-created");
		const result = materializeDefaultModelRateCatalog({ REFARM_HOME: home });
		expect(result.status).toBe("materialized");
		expect(fs.existsSync(path.join(home, MODEL_RATE_CATALOG_FILE_NAME))).toBe(true);
	});
});
