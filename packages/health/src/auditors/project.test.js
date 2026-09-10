import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectAuditor, RefarmProjectAuditor } from "./project.js";

let rootDir;

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function makeWorkspacePackage(workspaceRoot, name, packageJson, files = []) {
	const packageDir = path.join(rootDir, workspaceRoot, name);
	writeJson(path.join(packageDir, "package.json"), packageJson);
	for (const file of files) {
		fs.mkdirSync(path.dirname(path.join(packageDir, file)), { recursive: true });
		fs.writeFileSync(path.join(packageDir, file), "", "utf-8");
	}
	return packageDir;
}

describe("ProjectAuditor", () => {
	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-"));
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("checks build configs across packages and apps", async () => {
		const auditor = new ProjectAuditor();
		makeWorkspacePackage(
			"packages",
			"has-build",
			{ name: "@refarm.dev/has-build", main: "./dist/index.js" },
			["tsconfig.json", "tsconfig.build.json"],
		);
		makeWorkspacePackage(
			"apps",
			"missing-build",
			{ name: "@refarm.dev/missing-build", main: "./dist/index.js" },
			["tsconfig.json"],
		);

		await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
			{ package: "apps/missing-build", type: "missing_build_config" },
		]);
	});

	it("flags a package whose dist is older than its src, and stays quiet when it is newer", async () => {
		// The failure this exists for: everything resolves to dist, so a consumer imports the stale
		// artifact and the symptom surfaces somewhere else entirely.
		const stale = makeWorkspacePackage("packages", "stale", { name: "stale" }, [
			"tsconfig.build.json",
			"dist/index.js",
		]);
		const fresh = makeWorkspacePackage("packages", "fresh", { name: "fresh" }, [
			"tsconfig.build.json",
			"dist/index.js",
		]);

		const old = new Date("2026-01-01T00:00:00Z");
		const recent = new Date("2026-01-02T00:00:00Z");
		// stale: source edited AFTER the build.
		fs.mkdirSync(path.join(stale, "src"), { recursive: true });
		fs.writeFileSync(path.join(stale, "src/index.ts"), "", "utf-8");
		fs.utimesSync(path.join(stale, "dist/index.js"), old, old);
		fs.utimesSync(path.join(stale, "src/index.ts"), recent, recent);
		// fresh: built after the last edit.
		fs.mkdirSync(path.join(fresh, "src"), { recursive: true });
		fs.writeFileSync(path.join(fresh, "src/index.ts"), "", "utf-8");
		fs.utimesSync(path.join(fresh, "src/index.ts"), old, old);
		fs.utimesSync(path.join(fresh, "dist/index.js"), recent, recent);

		const auditor = new ProjectAuditor();
		const staleBuilds = auditor.checkStaleBuilds(rootDir, { workspaceRoots: ["packages"] });

		expect(staleBuilds.map((i) => i.package)).toEqual(["packages/stale"]);
		expect(staleBuilds[0].type).toBe("stale_build");
		expect(staleBuilds[0].staleBySeconds).toBe(86_400);
	});

	it("says nothing about a package that was never built", async () => {
		// No dist is not staleness — the resolution status already reports an unbuilt package,
		// and reporting it twice would train the reader to skim this list.
		const pkg = makeWorkspacePackage("packages", "unbuilt", { name: "unbuilt" }, [
			"tsconfig.build.json",
		]);
		fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
		fs.writeFileSync(path.join(pkg, "src/index.ts"), "", "utf-8");

		const auditor = new ProjectAuditor();
		const staleBuilds = auditor.checkStaleBuilds(rootDir, { workspaceRoots: ["packages"] });

		expect(staleBuilds).toEqual([]);
	});

	it("accepts custom workspace roots", async () => {
		const auditor = new ProjectAuditor({ workspaceRoots: ["modules"] });
		makeWorkspacePackage(
			"modules",
			"missing-build",
			{ name: "@example/missing-build", main: "./dist/index.js" },
			["tsconfig.json"],
		);
		makeWorkspacePackage("apps", "ignored", { name: "@example/ignored", main: "./dist/index.js" }, [
			"tsconfig.json",
		]);

		await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
			{ package: "modules/missing-build", type: "missing_build_config" },
		]);
	});

	it("accepts custom auditor titles", () => {
		const auditor = new ProjectAuditor({ title: "Team Workspace Health" });

		expect(auditor.title).toBe("Team Workspace Health");
	});

	it("does not apply Refarm package exemptions by default", async () => {
		const auditor = new ProjectAuditor();
		makeWorkspacePackage(
			"packages",
			"tsconfig",
			{ name: "@refarm.dev/tsconfig", main: "./dist/index.js" },
			["tsconfig.json"],
		);

		await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
			{ package: "packages/tsconfig", type: "missing_build_config" },
		]);
		await expect(auditor.checkResolutionStatus(rootDir)).resolves.toEqual([
			{ package: "packages/tsconfig", mode: "LINKED (dist)" },
		]);
	});

	it("allows callers to override package exemptions", async () => {
		const auditor = new ProjectAuditor();
		makeWorkspacePackage(
			"packages",
			"tsconfig",
			{ name: "@example/tsconfig", main: "./dist/index.js" },
			["tsconfig.json"],
		);
		makeWorkspacePackage("modules", "meta", { name: "@example/meta", main: "./dist/index.js" }, [
			"tsconfig.json",
		]);

		await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
			{ package: "packages/tsconfig", type: "missing_build_config" },
		]);
		await expect(
			auditor.checkBuildConfigs(rootDir, {
				workspaceRoots: ["modules"],
				exemptPackageIds: ["modules/meta"],
			}),
		).resolves.toEqual([]);
	});

	it("reports resolution status with workspace root prefixes", async () => {
		const auditor = new ProjectAuditor();
		makeWorkspacePackage("packages", "published", {
			name: "@refarm.dev/published",
			main: "./dist/index.js",
		});
		makeWorkspacePackage("apps", "local", {
			name: "@refarm.dev/local",
			main: "./src/index.ts",
		});

		await expect(auditor.checkResolutionStatus(rootDir)).resolves.toEqual([
			{ package: "packages/published", mode: "LINKED (dist)" },
			{ package: "apps/local", mode: "LINKED (types)" },
		]);
	});

	it("validates optional project automation manifests", () => {
		const auditor = new ProjectAuditor();
		writeJson(path.join(rootDir, ".project", "automations.json"), {
			automations: [
				{
					id: "daily-handoff",
					name: "Daily handoff",
					status: "active",
					triggers: [
						{ type: "once", at: "2026-06-27T09:00:00.000Z" },
						{ type: "cron", schedule: "@daily" },
						{ type: "manual" },
						{ type: "event", eventType: "effort.completed" },
					],
				},
			],
		});

		expect(auditor.checkProjectAutomations(rootDir)).toEqual([]);
	});

	it("reports invalid project automation manifests", () => {
		const auditor = new ProjectAuditor();
		writeJson(path.join(rootDir, ".project", "automations.json"), {
			automations: [
				{
					id: "",
					name: "Broken automation",
					status: "paused",
					triggers: [
						{ type: "once", at: "not-a-date" },
						{ type: "cron", schedule: "" },
						{ type: "event" },
						{ type: "unknown" },
					],
				},
			],
		});

		expect(auditor.checkProjectAutomations(rootDir)).toEqual([
			expect.objectContaining({
				file: ".project/automations.json",
				type: "invalid_project_automation_id",
			}),
			expect.objectContaining({
				file: ".project/automations.json",
				type: "invalid_project_automation_status",
			}),
			expect.objectContaining({
				file: ".project/automations.json",
				type: "invalid_project_automation_once_trigger",
			}),
			expect.objectContaining({
				file: ".project/automations.json",
				type: "invalid_project_automation_cron_trigger",
			}),
			expect.objectContaining({
				file: ".project/automations.json",
				type: "invalid_project_automation_event_trigger",
			}),
			expect.objectContaining({
				file: ".project/automations.json",
				type: "invalid_project_automation_trigger_type",
			}),
		]);
	});

	it("warns when versioned root namespaces are not declared", () => {
		const auditor = new ProjectAuditor();
		initGitRoot(rootDir);
		fs.writeFileSync(path.join(rootDir, ".gitignore"), ".cache/\n", "utf-8");
		fs.mkdirSync(path.join(rootDir, ".project"), { recursive: true });
		fs.writeFileSync(path.join(rootDir, ".project", "handoff.json"), "{}\n", "utf-8");
		fs.mkdirSync(path.join(rootDir, ".github"), { recursive: true });
		fs.writeFileSync(path.join(rootDir, ".github", "workflow.yml"), "{}\n", "utf-8");
		execGit(rootDir, ["add", ".gitignore", ".project/handoff.json", ".github/workflow.yml"]);

		expect(auditor.checkWorkspaceNamespaces(rootDir)).toEqual([
			{
				path: ".project",
				type: "undeclared_workspace_namespace",
				category: "workspace-namespace",
				note: "Versioned root namespace must be declared in workspaceNamespaces.",
			},
		]);
	});

	it("reports a typed issue instead of a silent empty pass when git ls-files cannot run", () => {
		// rootDir here (from beforeEach) has no .git at all, so `git ls-files -z`
		// fails with a real, non-mocked "not a git repository" error. Calling
		// checkWorkspaceNamespaces directly (bypassing the applicable() gate that
		// audit() enforces) proves this specific function's own honesty: the old
		// code caught this and returned [], indistinguishable from "scanned, found
		// nothing to warn about".
		const auditor = new ProjectAuditor();

		expect(auditor.checkWorkspaceNamespaces(rootDir)).toEqual([
			expect.objectContaining({ type: "workspace_namespace_scan_unreachable" }),
		]);
	});

	it("accepts declared versioned root namespaces", () => {
		const auditor = new ProjectAuditor({
			workspaceNamespaces: [{ path: ".project", owner: "pi-project-workflows" }],
		});
		initGitRoot(rootDir);
		fs.mkdirSync(path.join(rootDir, ".project"), { recursive: true });
		fs.writeFileSync(path.join(rootDir, ".project", "handoff.json"), "{}\n", "utf-8");
		execGit(rootDir, ["add", ".project/handoff.json"]);

		expect(auditor.checkWorkspaceNamespaces(rootDir)).toEqual([]);
	});

	describe("audit() — project-base applicability", () => {
		it("runs its checks normally when rootDir is a project (has .git)", async () => {
			initGitRoot(rootDir);
			makeWorkspacePackage(
				"packages",
				"missing-build",
				{ name: "@example/missing-build", main: "./dist/index.js" },
				["tsconfig.json"],
			);

			const auditor = new ProjectAuditor();
			const result = await auditor.audit({ rootDir });

			expect(result.applicable).toBe(true);
			expect(result.reason).toBeUndefined();
			expect(result.builds).toEqual([{ package: "packages/missing-build", type: "missing_build_config" }]);
		});

		it("does NOT run build/alignment/automation checks, and says why, when rootDir is not a project", async () => {
			// The node-base shape: no .git here, but a package that HAPPENS to
			// exist below it (e.g. a vendored checkout). Without the gate this
			// would silently read as "checked, no missing build configs" rather
			// than "there is no project here to check".
			makeWorkspacePackage(
				"packages",
				"missing-build",
				{ name: "@example/missing-build", main: "./dist/index.js" },
				["tsconfig.json"],
			);

			const auditor = new ProjectAuditor();
			const result = await auditor.audit({ rootDir });

			expect(result.applicable).toBe(false);
			expect(result.reason).toContain(rootDir);
			expect(result.builds).toEqual([]);
			expect(result.alignment).toEqual([]);
			expect(result.staleBuilds).toEqual([]);
			expect(result.automations).toEqual([]);
			expect(result.namespaceWarnings).toEqual([]);
		});

		it("still forwards generic_fs's git findings through when present, even though it does not apply itself", async () => {
			// HealthCore always feeds ProjectAuditor whatever generic_fs produced,
			// via context.generic_fs — that pass-through must survive the
			// inapplicability gate rather than being zeroed along with it.
			const auditor = new ProjectAuditor();
			const result = await auditor.audit({
				rootDir,
				generic_fs: { git: [{ file: "x.ts", type: "git_ignored", path: "/x.ts" }] },
			});

			expect(result.applicable).toBe(false);
			expect(result.git).toEqual([{ file: "x.ts", type: "git_ignored", path: "/x.ts" }]);
		});
	});
});

describe("RefarmProjectAuditor", () => {
	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-"));
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("applies Refarm package exemptions as an explicit preset", async () => {
		const auditor = new RefarmProjectAuditor();
		makeWorkspacePackage(
			"packages",
			"tsconfig",
			{ name: "@refarm.dev/tsconfig", main: "./dist/index.js" },
			["tsconfig.json"],
		);
		makeWorkspacePackage(
			"packages",
			"deps",
			{ name: "@refarm.dev/deps", main: "./dist/index.js" },
			["tsconfig.json"],
		);

		expect(auditor.title).toBe("Refarm Monorepo Health");
		await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([]);
		await expect(auditor.checkResolutionStatus(rootDir)).resolves.toEqual([
			{ package: "packages/deps", mode: "LINKED (dist)" },
			{ package: "packages/tsconfig", mode: "LINKED (dist)" },
		]);
	});
});

function initGitRoot(cwd) {
	execGit(cwd, ["init", "--quiet"]);
}

function execGit(cwd, args) {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}
