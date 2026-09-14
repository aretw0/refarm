import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolchainAuditor } from "./toolchain.js";

let rootDir;

function writeFile(relativePath, content = "") {
	const filePath = path.join(rootDir, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

function fakeSpawn(responses = {}) {
	return (command, args) => {
		const display = [command, ...(args || [])].join(" ");
		const response = responses[display] || { status: 1, stdout: "", stderr: "missing" };
		return {
			status: response.status,
			stdout: response.stdout || "",
			stderr: response.stderr || "",
		};
	};
}

describe("ToolchainAuditor", () => {
	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-toolchain-"));
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("reports path checks, command versions, and any-command candidates", async () => {
		fs.mkdirSync(path.join(rootDir, "node_modules", ".bin"), { recursive: true });
		writeFile("requirements.txt", "");

		const auditor = new ToolchainAuditor({
			pathChecks: [
				{ id: "node_modules", label: "workspace dependencies", path: "node_modules" },
				{ id: "requirements", label: "Python requirements", path: "requirements.txt" },
				{ id: "missing_optional", label: "Optional file", path: "optional.txt", required: false },
			],
			commandChecks: [
				{ id: "node", command: "node", args: ["--version"] },
				{ id: "uv", command: "uv", args: ["--version"] },
			],
			anyCommandChecks: [
				{
					id: "python",
					label: "Python runtime",
					candidates: [
						{ command: "python3", args: ["--version"] },
						{ command: "python", args: ["--version"] },
					],
				},
			],
			spawnSync: fakeSpawn({
				"node --version": { status: 0, stdout: "v24.0.0\n" },
				"uv --version": { status: 1, stderr: "uv missing\n" },
				"python3 --version": { status: 1, stderr: "python3 missing\n" },
				"python --version": { status: 0, stdout: "Python 3.13.0\n" },
			}),
			platform: "linux",
		});

		const report = await auditor.audit({ rootDir });

		expect(report.ok).toBe(false);
		expect(report.missing).toEqual(["uv"]);
		expect(report.mountIssues).toEqual([]);
		expect(report.checks).toEqual([
			{
				id: "node_modules",
				label: "workspace dependencies",
				ok: true,
				required: true,
				path: "node_modules",
			},
			{
				id: "requirements",
				label: "Python requirements",
				ok: true,
				required: true,
				path: "requirements.txt",
			},
			{
				id: "missing_optional",
				label: "Optional file",
				ok: false,
				required: false,
				path: "optional.txt",
			},
			{
				id: "node",
				label: "node --version",
				ok: true,
				required: true,
				command: "node --version",
				version: "v24.0.0",
				state: "ok",
				measuredVersion: "24.0.0",
				stderr: undefined,
			},
			{
				id: "uv",
				label: "uv --version",
				ok: false,
				required: true,
				command: "uv --version",
				version: undefined,
				state: "absent",
				detail: "`uv` is declared by this node and did not run.",
				stderr: "uv missing",
			},
			{
				id: "python",
				label: "Python runtime",
				ok: true,
				required: true,
				command: "python --version",
				version: "Python 3.13.0",
				state: "ok",
				measuredVersion: "3.13.0",
				stderr: undefined,
			},
		]);
	});

	it("FAILS a tool that runs but is older than the declared minimum", async () => {
		// The case this was extended for, measured on a real node: `gh` 2.4.0 from 2022 exits 0 for
		// `--version`, so every presence check passes and the node reports a healthy toolchain right
		// up to the first command that version does not have.
		const auditor = new ToolchainAuditor({
			commandChecks: [{ id: "gh", command: "gh", minVersion: "2.40.0", why: "CI handoffs" }],
			spawnSync: fakeSpawn({ "gh --version": { status: 0, stdout: "gh version 2.4.0 (2022-03-30)" } }),
		});

		const report = await auditor.audit({ rootDir });
		expect(report.ok).toBe(false);
		expect(report.missing).toEqual(["gh"]);
		const [check] = report.checks;
		expect(check.state).toBe("outdated");
		expect(check.measuredVersion).toBe("2.4.0");
		expect(check.detail).toContain("2.40.0");
		expect(check.detail).toContain("CI handoffs");
	});

	it("does not call a tool satisfied when its version could not be read", async () => {
		// `cannot-say` is not `ok`. A banner this build cannot parse leaves the declared minimum
		// UNVERIFIED, and reporting it as met is reporting success on a claim nothing measured.
		const auditor = new ToolchainAuditor({
			commandChecks: [{ id: "vpn", command: "ovpnctl", minVersion: "1.0.0" }],
			spawnSync: fakeSpawn({ "ovpnctl --version": { status: 0, stdout: "ovpnctl (build unknown)" } }),
		});

		const report = await auditor.audit({ rootDir });
		expect(report.checks[0].state).toBe("cannot-say");
		expect(report.checks[0].ok).toBe(false);
		expect(report.checks[0].detail).toMatch(/UNVERIFIED/u);
	});

	it("checks the devcontainer node_modules volume mount when declared", async () => {
		fs.mkdirSync(path.join(rootDir, ".devcontainer"), { recursive: true });
		writeFile(
			".devcontainer/devcontainer.json",
			JSON.stringify({
				mounts: [
					`source=refarm-node-modules,target=${path.join(rootDir, "node_modules")},type=volume`,
				],
			}),
		);

		const auditor = new ToolchainAuditor({
			devcontainerNodeModulesMount: true,
			platform: "linux",
			mountInfoReader: async () =>
				[`30 20 0:45 / ${path.join(rootDir, "other")} rw,relatime - ext4 /dev/sda rw`].join("\n"),
		});

		const report = await auditor.audit({ rootDir });

		expect(report.ok).toBe(false);
		expect(report.missing).toEqual(["devcontainer_node_modules_mount"]);
		expect(report.mountIssues).toEqual([
			{
				id: "devcontainer_node_modules_mount",
				path: "node_modules",
				target: path.join(rootDir, "node_modules"),
			},
		]);
		expect(report.checks).toEqual([
			{
				id: "devcontainer_node_modules_mount",
				label: "devcontainer node_modules volume mount",
				ok: false,
				required: true,
				path: "node_modules",
				target: path.join(rootDir, "node_modules"),
			},
		]);
	});
});
