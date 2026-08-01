import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkspaceAdd } from "./workspace-add.js";

const roots: string[] = [];

function tempRoot(prefix: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace add", () => {
	it("writes only the operator catalog after explicit consent", async () => {
		const operatorRoot = tempRoot("refarm-workspace-operator-");
		const workspace = tempRoot("refarm-workspace-target-");
		fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "my-app" }));

		const result = await runWorkspaceAdd(
			{ path: workspace },
			{
				root: operatorRoot,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["accept", "authorize"]),
				now: () => "2026-08-01T00:00:00.000Z",
				decidedBy: "test",
				host: "test-host",
				announce: () => {},
			},
		);

		expect(result.status).toBe("declared");
		const config = JSON.parse(
			fs.readFileSync(path.join(operatorRoot, ".refarm", "config.json"), "utf8"),
		);
		expect(config.workspaces["my-app"]).toMatchObject({ path: workspace, kind: "project" });
		expect(fs.existsSync(path.join(workspace, ".refarm", "config.json"))).toBe(false);
	});

	it("treats REFARM_HOME as the sovereign directory, never its parent or a nested copy", async () => {
		const host = tempRoot("refarm-workspace-custom-home-");
		const refarmHome = path.join(host, "custom-state");
		const workspace = tempRoot("refarm-workspace-custom-target-");
		fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "custom-app" }));

		await runWorkspaceAdd(
			{ path: workspace },
			{
				env: { REFARM_HOME: refarmHome },
				interactive: true,
				operator: createScriptedOperatorChannel(["accept", "authorize"]),
				announce: () => {},
			},
		);

		expect(fs.existsSync(path.join(refarmHome, "config.json"))).toBe(true);
		expect(fs.existsSync(path.join(refarmHome, ".refarm", "config.json"))).toBe(false);
	});

	it("refuses a missing host path before proposing a mutation", async () => {
		await expect(
			runWorkspaceAdd(
				{ path: "/definitely/missing/refarm-workspace" },
				{
					root: tempRoot("refarm-workspace-missing-"),
					interactive: true,
					operator: createScriptedOperatorChannel([]),
					announce: () => {},
				},
			),
		).rejects.toMatchObject({ code: "workspace-add-missing-path" });
	});

	it("never prompts or writes when no surface is attending", async () => {
		const operatorRoot = tempRoot("refarm-workspace-headless-");
		await expect(
			runWorkspaceAdd({ path: operatorRoot }, { root: operatorRoot, interactive: false }),
		).rejects.toMatchObject({ code: "workspace-add-not-interactive" });
		expect(fs.existsSync(path.join(operatorRoot, ".refarm"))).toBe(false);
	});
});
