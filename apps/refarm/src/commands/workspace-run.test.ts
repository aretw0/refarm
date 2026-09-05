import { describe, expect, it } from "vitest";
import { runDeclaredWorkspaceCommand, type WorkspaceRunSpec } from "./workspace.js";

/**
 * `refarm workspace run <ws> <cmd>` resolves a NAMED declared command (an allowlist, not a shell)
 * to an argv + cwd and runs it. The runner is injected, so this needs no real process.
 */

const config = {
	workspaces: {
		rcdc5: {
			path: "../rcdc5",
			kind: "project",
			commands: {
				vpn: "pnpm --filter @rcdcp/serpro-vpn run vpn connect",
				scrape: { run: ["node", "src/index.js"], cwd: "packages/scraper-playwright" },
			},
		},
	},
};

const deps = { cwd: () => "/home/me/git/refarm", loadConfig: () => config };

describe("runDeclaredWorkspaceCommand", () => {
	it("resolves a declared command to argv + workspace cwd and runs it, forwarding extra args", async () => {
		const seen: WorkspaceRunSpec[] = [];
		const result = await runDeclaredWorkspaceCommand(
			{ workspace: "rcdc5", command: "vpn", extraArgs: ["serpro"] },
			deps,
			async (spec) => {
				seen.push(spec);
				return 0;
			},
		);

		expect(seen[0]?.command).toBe("pnpm");
		expect(seen[0]?.args).toEqual(["--filter", "@rcdcp/serpro-vpn", "run", "vpn", "connect", "serpro"]);
		expect(seen[0]?.cwd).toBe("/home/me/git/rcdc5"); // ../rcdc5 resolved against the base dir
		expect(result.exitCode).toBe(0);
		expect(result.argv[0]).toBe("pnpm");
	});

	it("honors a command's own cwd (joined onto the workspace path)", async () => {
		let cwd = "";
		await runDeclaredWorkspaceCommand({ workspace: "rcdc5", command: "scrape", extraArgs: [] }, deps, async (spec) => {
			cwd = spec.cwd;
			return 0;
		});
		expect(cwd).toBe("/home/me/git/rcdc5/packages/scraper-playwright");
	});

	it("rejects a command NAME not in the allowlist (not a shell)", async () => {
		await expect(
			runDeclaredWorkspaceCommand({ workspace: "rcdc5", command: "rm", extraArgs: ["-rf", "/"] }, deps, async () => 0),
		).rejects.toThrow(/not declared for workspace/);
	});

	it("rejects an undeclared workspace", async () => {
		await expect(
			runDeclaredWorkspaceCommand(
				{ workspace: "ghost", command: "vpn", extraArgs: [] },
				{ cwd: () => "/base", loadConfig: () => ({ workspaces: {} }) },
				async () => 0,
			),
		).rejects.toThrow(/not declared in config/);
	});

	it("propagates the command's exit code", async () => {
		const result = await runDeclaredWorkspaceCommand(
			{ workspace: "rcdc5", command: "vpn", extraArgs: [] },
			deps,
			async () => 3,
		);
		expect(result.exitCode).toBe(3);
	});
});
