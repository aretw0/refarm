import { describe, expect, it } from "vitest";

import { createProcessHandoffSpecFromRunner } from "./process-handoff.js";

describe("process-handoff compatibility export", () => {
	it("keeps the cli subpath wired to the leaf process package", () => {
		expect(
			createProcessHandoffSpecFromRunner("node", ["scripts/etl.mjs"], {
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
