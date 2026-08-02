import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	runWorkspaceCommandAdd,
	runWorkspaceCommandRemote,
	runWorkspaceCommandRemove,
} from "./workspace-command-add.js";

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

	it("persists remote admission only when explicitly reviewed", async () => {
		const root = fixture();
		await runWorkspaceCommandAdd(
			{ workspace: "app", name: "status", argv: ["app", "status"], remote: true },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["authorize"]),
				announce: () => {},
			},
		);

		const config = JSON.parse(
			fs.readFileSync(path.join(root, ".refarm", "config.json"), "utf8"),
		);
		expect(config.workspaces.app.commands.status).toEqual({
			run: ["app", "status"],
			remote: true,
		});
	});

	it("persists a reviewed closed result contract beside the exact argv", async () => {
		const root = fixture();
		await runWorkspaceCommandAdd(
			{
				workspace: "app",
				name: "check",
				argv: ["app", "check"],
				remote: true,
				result: "operation-result.v1",
			},
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["authorize"]),
				announce: () => {},
			},
		);
		const config = JSON.parse(fs.readFileSync(path.join(root, ".refarm", "config.json"), "utf8"));
		expect(config.workspaces.app.commands.check).toEqual({
			run: ["app", "check"],
			remote: true,
			result: "operation-result.v1",
		});
	});

	it("removes only the authorized command and preserves sibling workspace data", async () => {
		const root = fixture();
		const configPath = path.join(root, ".refarm", "config.json");
		const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
		config.workspaces.app.commands = {
			stale: { run: ["old-bin"] },
			keep: { run: ["pnpm", "test"] },
		};
		fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

		const result = await runWorkspaceCommandRemove(
			{ workspace: "app", name: "stale" },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["authorize"]),
				announce: () => {},
			},
		);

		expect(result.status).toBe("declared");
		const after = JSON.parse(fs.readFileSync(configPath, "utf8"));
		expect(after.workspaces.app.commands).toEqual({ keep: { run: ["pnpm", "test"] } });
		expect(after.workspaces.app).toMatchObject({ path: "/work/app", kind: "project" });
	});
});

describe("workspace command remote admission", () => {
	it("enables remote access without changing any existing operation field", async () => {
		const root = fixture();
		const configPath = path.join(root, ".refarm", "config.json");
		const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
		config.workspaces.app.commands = {
			status: {
				run: ["app", "status", "value with spaces"],
				cwd: "packages/app",
				description: "Current status",
			},
		};
		fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

		await runWorkspaceCommandRemote(
			{ workspace: "app", name: "status", remote: true },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["authorize"]),
				announce: () => {},
			},
		);

		const after = JSON.parse(fs.readFileSync(configPath, "utf8"));
		expect(after.workspaces.app.commands.status).toEqual({
			run: ["app", "status", "value with spaces"],
			cwd: "packages/app",
			description: "Current status",
			remote: true,
		});
	});

	it("disables remote access by removing only the admission marker", async () => {
		const root = fixture();
		const configPath = path.join(root, ".refarm", "config.json");
		const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
		config.workspaces.app.commands = {
			status: { run: ["app", "status"], description: "Current status", remote: true },
		};
		fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

		await runWorkspaceCommandRemote(
			{ workspace: "app", name: "status", remote: false },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["authorize"]),
				announce: () => {},
			},
		);

		const after = JSON.parse(fs.readFileSync(configPath, "utf8"));
		expect(after.workspaces.app.commands.status).toEqual({
			run: ["app", "status"],
			description: "Current status",
		});
	});

	it("refuses missing and already-matching operations without writing", async () => {
		const root = fixture();
		await expect(
			runWorkspaceCommandRemote(
				{ workspace: "app", name: "missing", remote: true },
				{ root, env: { SOVEREIGN_DIR: ".refarm" }, interactive: true },
			),
		).rejects.toMatchObject({ code: "workspace-command-not-declared" });
	});
});
