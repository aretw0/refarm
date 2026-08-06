import type { DeclaredWorkspaceConfig } from "@refarm.dev/config";
import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceOffer } from "./workspace-declaration.js";
import { describeNothingToSync, planWorkspaceSync, runWorkspaceSync } from "./workspace-sync.js";
import type { WorkspaceDeclaredCommand } from "./workspace.js";

function catalogEntry(commands: Record<string, WorkspaceDeclaredCommand>): DeclaredWorkspaceConfig {
	return {
		id: "app",
		path: ".",
		absolutePath: "/work/app",
		kind: "project",
		execution: { preferredAdapter: "auto" },
		cache: { local: true, remote: null },
		repository: null,
		bridges: [],
		commands,
	} as unknown as DeclaredWorkspaceConfig;
}

describe("planWorkspaceSync — PURE, literals only", () => {
	it("offers commands the catalog lacks — all additions", () => {
		const offer: WorkspaceOffer = { commands: { build: { run: ["pnpm", "build"] } } };
		const plan = planWorkspaceSync({ offer, catalogEntry: catalogEntry({}) });

		expect(plan.additions).toEqual([{ name: "build", command: { run: ["pnpm", "build"] } }]);
		expect(plan.collisions).toEqual([]);
		expect(plan.unchanged).toEqual([]);
	});

	it("KEEPS the node's definition on a name collision and SURFACES the workspace's rejected one", () => {
		const kept = { run: ["node", "node-version.mjs"] };
		const rejected = { run: ["node", "workspace-version.mjs"] };
		const offer: WorkspaceOffer = { commands: { deploy: rejected } };
		const plan = planWorkspaceSync({ offer, catalogEntry: catalogEntry({ deploy: kept }) });

		expect(plan.additions).toEqual([]);
		expect(plan.unchanged).toEqual([]);
		expect(plan.collisions).toEqual([{ name: "deploy", kept, rejected }]);
		// The failure shape this exists to prevent: a plan that dropped the workspace's
		// version silently. Assert the rejected definition is genuinely present.
		expect(plan.collisions[0]?.rejected).toEqual(rejected);
		expect(plan.collisions[0]?.kept).toEqual(kept);
	});

	it("treats a same-argv command with a different remote admission as a collision, not unchanged", () => {
		const offer: WorkspaceOffer = { commands: { vpn: { run: ["vpn", "up"], remote: true } } };
		const plan = planWorkspaceSync({ offer, catalogEntry: catalogEntry({ vpn: { run: ["vpn", "up"] } }) });

		expect(plan.collisions).toEqual([
			{ name: "vpn", kept: { run: ["vpn", "up"] }, rejected: { run: ["vpn", "up"], remote: true } },
		]);
		expect(plan.additions).toEqual([]);
	});

	it("is a no-op, with no noise, when the offer matches what the catalog already holds", () => {
		const command = { run: ["pnpm", "test"] };
		const offer: WorkspaceOffer = { commands: { test: command } };
		const plan = planWorkspaceSync({ offer, catalogEntry: catalogEntry({ test: { run: ["pnpm", "test"] } }) });

		expect(plan.unchanged).toEqual([{ name: "test", command: { run: ["pnpm", "test"] } }]);
		expect(plan.additions).toEqual([]);
		expect(plan.collisions).toEqual([]);
	});

	it("ignores catalog-only provenance when comparing for equality", () => {
		const offer: WorkspaceOffer = { commands: { build: { run: ["pnpm", "build"] } } };
		const plan = planWorkspaceSync({
			offer,
			catalogEntry: catalogEntry({
				build: { run: ["pnpm", "build"], source: "workspace-offer" } as WorkspaceDeclaredCommand,
			}),
		});

		expect(plan.unchanged).toEqual([
			{ name: "build", command: { run: ["pnpm", "build"], source: "workspace-offer" } },
		]);
		expect(plan.additions).toEqual([]);
		expect(plan.collisions).toEqual([]);
	});

	it("an empty offer is a valid no-op, not an error", () => {
		const plan = planWorkspaceSync({
			offer: { commands: {} },
			catalogEntry: catalogEntry({ existing: { run: ["x"] } }),
		});

		expect(plan).toEqual({ additions: [], collisions: [], unchanged: [] });
	});
});

describe("describeNothingToSync — PURE, tells the truth about WHY", () => {
	it("names the collision count rather than reading as 'nothing to see'", () => {
		const plan = planWorkspaceSync({
			offer: { commands: { deploy: { run: ["workspace"] } } },
			catalogEntry: catalogEntry({ deploy: { run: ["node"] } }),
		});
		expect(describeNothingToSync(plan)).toBe("nothing to accept — 1 collision reported");
	});

	it("pluralizes multiple collisions", () => {
		const plan = planWorkspaceSync({
			offer: { commands: { a: { run: ["x"] }, b: { run: ["y"] } } },
			catalogEntry: catalogEntry({ a: { run: ["node"] }, b: { run: ["node"] } }),
		});
		expect(describeNothingToSync(plan)).toBe("nothing to accept — 2 collisions reported");
	});

	it("says already up to date when the offer only repeats what the catalog holds", () => {
		const plan = planWorkspaceSync({
			offer: { commands: { deploy: { run: ["node"] } } },
			catalogEntry: catalogEntry({ deploy: { run: ["node"] } }),
		});
		expect(describeNothingToSync(plan)).toBe("nothing to accept — already up to date");
	});

	it("says the workspace offers nothing for a genuinely empty offer", () => {
		const plan = planWorkspaceSync({ offer: { commands: {} }, catalogEntry: catalogEntry({}) });
		expect(describeNothingToSync(plan)).toBe("nothing to accept — the workspace offers nothing");
	});
});

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(options?: { workspaceJson?: unknown }): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-workspace-sync-"));
	roots.push(root);
	fs.mkdirSync(path.join(root, ".refarm"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".refarm", "config.json"),
		`${JSON.stringify(
			{
				workspaces: {
					app: {
						path: ".",
						kind: "project",
						execution: { preferredAdapter: "auto" },
						commands: { deploy: { run: ["node", "node-deploy.mjs"] } },
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	if (options?.workspaceJson !== undefined) {
		fs.writeFileSync(
			path.join(root, "refarm.workspace.json"),
			`${JSON.stringify(options.workspaceJson, null, 2)}\n`,
		);
	}
	return root;
}

function readConfig(root: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(path.join(root, ".refarm", "config.json"), "utf8"));
}

describe("runWorkspaceSync — the command", () => {
	it("a workspace with no workspace.json offers nothing — not an error", async () => {
		const root = fixture();
		const result = await runWorkspaceSync(
			{ workspace: "app", json: true },
			{ root, env: { SOVEREIGN_DIR: ".refarm" } },
		);

		expect(result.status).toBe("inspected");
		expect(result.plan).toEqual({ additions: [], collisions: [], unchanged: [] });
	});

	it("refuses a workspace id the node catalog does not declare", async () => {
		const root = fixture();
		await expect(
			runWorkspaceSync({ workspace: "ghost", json: true }, { root, env: { SOVEREIGN_DIR: ".refarm" } }),
		).rejects.toMatchObject({ code: "workspace-sync-not-declared" });
	});

	it("surfaces parseWorkspaceOffer's own refusal for a malformed offer rather than re-validating", async () => {
		const root = fixture({ workspaceJson: { workspaces: { other: { path: "/x" } } } });
		await expect(
			runWorkspaceSync({ workspace: "app", json: true }, { root, env: { SOVEREIGN_DIR: ".refarm" } }),
		).rejects.toMatchObject({ code: "workspace-sync-offer-invalid" });
	});

	it("refuses invalid JSON in workspace.json rather than guessing", async () => {
		const root = fixture();
		fs.writeFileSync(path.join(root, "refarm.workspace.json"), "{ not json");
		await expect(
			runWorkspaceSync({ workspace: "app", json: true }, { root, env: { SOVEREIGN_DIR: ".refarm" } }),
		).rejects.toMatchObject({ code: "workspace-sync-offer-unreadable" });
	});

	it("--json prints the plan and writes nothing", async () => {
		const root = fixture({ workspaceJson: { commands: { build: { run: ["pnpm", "build"] } } } });
		const before = fs.readFileSync(path.join(root, ".refarm", "config.json"), "utf8");

		const result = await runWorkspaceSync(
			{ workspace: "app", json: true },
			{ root, env: { SOVEREIGN_DIR: ".refarm" } },
		);

		expect(result.status).toBe("inspected");
		expect(result.plan.additions).toEqual([{ name: "build", command: { run: ["pnpm", "build"] } }]);
		expect(fs.readFileSync(path.join(root, ".refarm", "config.json"), "utf8")).toBe(before);
	});

	it("roots at REFARM_HOME's catalog — the same base `workspace add`/`workspace command add` write to — never a different catalog sitting at the current directory", async () => {
		// The REAL catalog: exactly where `workspace add` (`workspace-add.ts`) and
		// `workspace command add` (`workspace-command-add.ts`) resolve their root —
		// `path.dirname(path.resolve(resolveRefarmHome(env)))` — and would have written.
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-workspace-sync-home-"));
		roots.push(home);
		const refarmHome = path.join(home, ".refarm");
		const homeAppPath = path.join(home, "app");
		fs.mkdirSync(refarmHome, { recursive: true });
		fs.mkdirSync(homeAppPath, { recursive: true });
		fs.writeFileSync(
			path.join(refarmHome, "config.json"),
			`${JSON.stringify(
				{
					workspaces: {
						app: {
							path: homeAppPath,
							kind: "project",
							execution: { preferredAdapter: "auto" },
							commands: { deploy: { run: ["node", "home-deploy.mjs"] } },
						},
					},
				},
				null,
				2,
			)}\n`,
		);

		// A DIFFERENT catalog, declaring the SAME id "app" with DIFFERENT content, sitting
		// at the process's current directory — the exact shape of the reported bug (the
		// operator's default shell is not their sovereign base). A wrong (cwd-rooted)
		// resolution finds THIS catalog instead and produces a visibly different,
		// wrong result — a test that passed under either rooting is impossible.
		const decoyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-workspace-sync-decoy-cwd-"));
		roots.push(decoyCwd);
		fs.mkdirSync(path.join(decoyCwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(decoyCwd, ".refarm", "config.json"),
			`${JSON.stringify(
				{ workspaces: { app: { path: ".", commands: { deploy: { run: ["decoy-deploy"] } } } } },
				null,
				2,
			)}\n`,
		);

		const originalCwd = process.cwd();
		process.chdir(decoyCwd);
		try {
			const result = await runWorkspaceSync(
				{ workspace: "app", json: true },
				// No `root` override, no `cwd` field (it no longer exists on `WorkspaceSyncDeps`) —
				// only `REFARM_HOME`, exactly what `workspace add`/`workspace command add` read.
				{ env: { REFARM_HOME: refarmHome, SOVEREIGN_DIR: ".refarm" } },
			);

			expect(result.configPath).toBe(path.join(refarmHome, "config.json"));
			expect(result.offerPath).toBe(path.join(homeAppPath, "refarm.workspace.json"));
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("reports nothing-to-sync for an empty offer without prompting the operator", async () => {
		const root = fixture({ workspaceJson: {} });
		const result = await runWorkspaceSync(
			{ workspace: "app" },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel([]),
				announce: () => {},
			},
		);

		expect(result.status).toBe("nothing-to-sync");
	});

	it("accepts additions with workspace-offer provenance, and leaves the node's collision-winning definition untouched", async () => {
		const root = fixture({
			workspaceJson: {
				commands: {
					build: { run: ["pnpm", "build"] },
					deploy: { run: ["node", "workspace-deploy.mjs"] },
				},
			},
		});

		const result = await runWorkspaceSync(
			{ workspace: "app" },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["authorize"]),
				announce: () => {},
				now: () => "2026-08-06T00:00:00.000Z",
				decidedBy: "test",
				host: "test-host",
			},
		);

		expect(result.status).toBe("declared");
		expect(result.plan.additions).toEqual([{ name: "build", command: { run: ["pnpm", "build"] } }]);
		expect(result.plan.collisions).toEqual([
			{
				name: "deploy",
				kept: { run: ["node", "node-deploy.mjs"] },
				rejected: { run: ["node", "workspace-deploy.mjs"] },
			},
		]);

		const config = readConfig(root);
		expect(config).toMatchObject({
			workspaces: {
				app: {
					commands: {
						build: { run: ["pnpm", "build"], source: "workspace-offer" },
						// the node's own definition — untouched, no provenance tag invented for it
						deploy: { run: ["node", "node-deploy.mjs"] },
					},
				},
			},
		});
	});

	it("writes nothing when the operator declines", async () => {
		const root = fixture({ workspaceJson: { commands: { build: { run: ["pnpm", "build"] } } } });
		const before = readConfig(root);

		const result = await runWorkspaceSync(
			{ workspace: "app" },
			{
				root,
				env: { SOVEREIGN_DIR: ".refarm" },
				interactive: true,
				operator: createScriptedOperatorChannel(["decline"]),
				announce: () => {},
			},
		);

		expect(result.status).toBe("declined");
		expect(readConfig(root)).toEqual(before);
	});
});
