import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReleaseCommand } from "../../src/commands/release.js";

const tempDirs: string[] = [];

function createReleaseWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "refarm-release-command-"));
	tempDirs.push(root);
	mkdirSync(join(root, "packages", "storage-contract-v1"), { recursive: true });
	mkdirSync(join(root, ".refarm"), { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ name: "release-root", private: true }, null, 2),
	);
	writeFileSync(
		join(root, "packages", "storage-contract-v1", "package.json"),
		JSON.stringify(
			{
				name: "@refarm.dev/storage-contract-v1",
				version: "0.1.0",
				private: false,
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(root, ".refarm", "config.json"),
		JSON.stringify(
			{
				releasePolicy: {
					policyVersion: "2026-01",
					mode: "changeset",
					providers: [
						{
							id: "changesets",
							type: "changesets",
							supportsPublish: true,
							supportsDryRun: true,
							publishCommands: ["pnpm changeset publish --dry-run"],
						},
					],
					defaultSelection: "kernel-candidates",
					selections: [
						{
							id: "kernel-candidates",
							profileTags: ["kernel", "candidate"],
						},
					],
					packageProfiles: [
						{
							id: "@refarm.dev/storage-contract-v1",
							risk: "core",
							tags: ["contract", "kernel", "candidate"],
							mustPassChecks: ["pnpm run gate:smoke:contracts"],
						},
					],
					phases: [
						{
							id: "preflight",
							name: "Preflight",
							commands: ["echo preflight"],
							required: true,
							riskWeight: 1,
						},
					],
				},
			},
			null,
			2,
		),
	);
	return root;
}

describe("release command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
		while (tempDirs.length > 0) {
			rmSync(tempDirs.pop()!, { recursive: true, force: true });
		}
	});

	it("plans release candidates by configured policy selection", async () => {
		const root = createReleaseWorkspace();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createReleaseCommand({ cwd: () => root }).parseAsync(
			["plan", "--selection", "default", "--json"],
			{ from: "user" },
		);

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "release",
			operation: "plan",
			ok: true,
			status: "ready",
			packageCount: 1,
			packages: ["@refarm.dev/storage-contract-v1"],
			profileTags: ["kernel", "candidate"],
			selection: {
				id: "kernel-candidates",
			},
			packageProfiles: [
				{
					id: "@refarm.dev/storage-contract-v1",
					risk: "core",
					tags: ["contract", "kernel", "candidate"],
					mustPassChecks: ["pnpm run gate:smoke:contracts"],
				},
			],
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		});
	});

	it.each(["plan", "check", "gates"])(
		"prints structured JSON when release policy selection is missing for %s",
		async (operation) => {
			const root = createReleaseWorkspace();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await createReleaseCommand({ cwd: () => root }).parseAsync(
				[operation, "--selection", "missing-selection", "--json"],
				{ from: "user" },
			);

			expect(process.exitCode).toBe(1);
			expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
				command: "release",
				operation,
				ok: false,
				status: "error",
				error: "release-command-failed",
				message:
					"Release policy selection not found: missing-selection. Available selections: kernel-candidates.",
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			});
		},
	);
});
