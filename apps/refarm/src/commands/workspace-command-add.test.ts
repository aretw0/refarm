import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkspaceCommandAdd } from "./workspace-command-add.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-workspace-command-"));
	roots.push(root);
	fs.mkdirSync(path.join(root, ".refarm"));
	fs.writeFileSync(
		path.join(root, ".refarm", "config.json"),
		`${JSON.stringify({ workspaces: { app: { path: "/work/app", kind: "project", execution: { preferredAdapter: "auto" } } } }, null, 2)}\n`,
	);
	return root;
}

describe("workspace command add", () => {
	it("preserves the workspace and writes only the authorized named argv", async () => {
		const root = fixture();
		const result = await runWorkspaceCommandAdd(
			{ workspace: "app", name: "test", argv: ["pnpm", "test", "value with spaces"], cwd: "packages/api" },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["authorize"]),
				announce: () => {},
				now: () => "2026-08-02T00:00:00.000Z",
				decidedBy: "test",
				host: "test-host",
			},
		);

		expect(result.status).toBe("declared");
		const config = JSON.parse(fs.readFileSync(path.join(root, ".refarm", "config.json"), "utf8"));
		expect(config.workspaces.app).toMatchObject({
			path: "/work/app",
			kind: "project",
			commands: { test: { run: ["pnpm", "test", "value with spaces"], cwd: "packages/api" } },
		});
	});

	it("refuses an unknown workspace without writing", async () => {
		const root = fixture();
		await expect(
			runWorkspaceCommandAdd(
				{ workspace: "ghost", name: "test", argv: ["pnpm", "test"] },
				{ root, env: { SOVEREIGN_DIR: ".refarm" }, interactive: true },
			),
		).rejects.toMatchObject({ code: "workspace-command-workspace-not-declared" });
	});
});
