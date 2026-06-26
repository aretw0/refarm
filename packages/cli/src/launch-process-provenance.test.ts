import { describe, expect, it } from "vitest";

import { createLaunchProcessSpecFromRunner } from "./launch-process.js";

describe("launch-process compatibility export", () => {
	it("keeps the cli subpath wired to the leaf process package", () => {
		expect(
			createLaunchProcessSpecFromRunner("node", ["scripts/etl.mjs"], {
				cwd: "/workspaces/vault-seed",
				display: "node scripts/etl.mjs",
			}),
		).toEqual({
			command: "node",
			args: ["scripts/etl.mjs"],
			cwd: "/workspaces/vault-seed",
			display: "node scripts/etl.mjs",
		});
	});
});
