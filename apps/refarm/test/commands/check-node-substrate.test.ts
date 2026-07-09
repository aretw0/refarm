import { describe, expect, it } from "vitest";

import {
	findSourceAccessIssuesForPaths,
	runNodeSubstrateCheckWithDeps,
} from "../../src/commands/check-node-substrate.js";

function fileStat() {
	return {
		uid: 1000,
		gid: 1000,
		mode: 0o644,
		isSymbolicLink: () => false,
		isFile: () => true,
	};
}

describe("check node substrate", () => {
	it("runs independent substrate probes concurrently", async () => {
		let active = 0;
		let maxActive = 0;
		const delay = async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
		};

		const result = await runNodeSubstrateCheckWithDeps({
			root: "/repo",
			platform: "linux",
			checkPackageManagerBins: async () => {
				await delay();
				return { missing: [], foreignPlatformShims: [] };
			},
			findMountIssues: async () => {
				await delay();
				return [];
			},
			findWorkspaceLinkChecks: async () => {
				await delay();
				return [];
			},
			findRuntimeChecks: async () => {
				await delay();
				return [];
			},
			findSourceAccessIssues: async () => {
				await delay();
				return [];
			},
			resolveInstallCommand: async () => {
				await delay();
				return "pnpm install --frozen-lockfile";
			},
		});

		expect(maxActive).toBeGreaterThan(1);
		expect(result.ok).toBe(true);
		expect(result.recommendations).toEqual([]);
	});

	it("checks tracked source access concurrently while preserving diagnostics", async () => {
		let active = 0;
		let maxActive = 0;
		const inaccessible = new Set(["/repo/packages/four/src/index.ts"]);
		const fs = {
			lstat: async (path: string) => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return fileStat();
			},
			stat: async () => fileStat(),
			access: async (path: string) => {
				if (inaccessible.has(path)) {
					throw new Error("permission denied");
				}
			},
		};

		const issues = await findSourceAccessIssuesForPaths(
			"/repo",
			[
				"packages/one/src/index.ts",
				"packages/two/src/index.ts",
				"packages/three/src/index.ts",
				"packages/four/src/index.ts",
			],
			{ concurrency: 2, fs },
		);

		expect(maxActive).toBeGreaterThan(1);
		expect(issues).toEqual([
			{
				path: "packages/four/src/index.ts",
				reason: "not-writable",
				uid: 1000,
				gid: 1000,
				mode: "644",
			},
		]);
	});
});
