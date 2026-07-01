import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildHealthAuditFingerprint,
	runHealthAudit,
	type HealthReport,
} from "../../src/commands/health.js";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
	vi.restoreAllMocks();
});

function createWorkspace(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-cache-"));
	tempRoots.push(root);
	fs.mkdirSync(path.join(root, "packages", "example"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "refarm.config.json"),
		`${JSON.stringify({
			health: {
				preset: "workspace",
				workspaceRoots: ["packages"],
				ignoredGitVisibilityPatterns: [],
			},
		}, null, 2)}\n`,
	);
	fs.writeFileSync(
		path.join(root, "packages", "example", "package.json"),
		`${JSON.stringify({
			name: "@example/cache",
			main: "dist/index.js",
			types: "dist/index.d.ts",
		}, null, 2)}\n`,
	);
	fs.writeFileSync(
		path.join(root, "packages", "example", "tsconfig.json"),
		"{}\n",
	);
	fs.writeFileSync(
		path.join(root, "packages", "example", "tsconfig.build.json"),
		"{}\n",
	);
	return root;
}

function healthCachePath(root: string): string {
	return path.join(root, ".refarm", "cache", "health-audit.json");
}

describe("health audit cache", () => {
	it("reuses matching local cache and invalidates when observed files change", async () => {
		const root = createWorkspace();
		vi.spyOn(console, "error").mockImplementation(() => {});

		const first = await runHealthAudit(root);
		expect(first.ok).toBe(true);
		expect(fs.existsSync(healthCachePath(root))).toBe(true);

		const cache = JSON.parse(
			fs.readFileSync(healthCachePath(root), "utf-8"),
		) as { report: HealthReport };
		cache.report = {
			...cache.report,
			resolution: [{ package: "cached-report", mode: "LINKED (dist)" }],
		};
		fs.writeFileSync(healthCachePath(root), `${JSON.stringify(cache, null, 2)}\n`);

		const second = await runHealthAudit(root);
		expect(second.resolution).toEqual([
			{ package: "cached-report", mode: "LINKED (dist)" },
		]);

		fs.rmSync(path.join(root, "packages", "example", "tsconfig.build.json"));
		const third = await runHealthAudit(root);
		expect(third.issueCount).toBe(1);
		expect(third.results.builds).toEqual([
			{ package: "packages/example", type: "missing_build_config" },
		]);
	});

	it("changes fingerprint when a source-level file changes", () => {
		const root = createWorkspace();
		const before = buildHealthAuditFingerprint(root);
		fs.writeFileSync(
			path.join(root, "packages", "example", "package.json"),
			`${JSON.stringify({
				name: "@example/cache",
				main: "dist/changed.js",
				types: "dist/index.d.ts",
			}, null, 2)}\n`,
		);

		expect(buildHealthAuditFingerprint(root)).not.toBe(before);
	});
});
