import { describe, expect, it } from "vitest";

import { describeWorkspaceTooling, measureWorkspaceTooling } from "./workspace-tooling.js";

/** A spawnSync that answers once and records what it was asked. */
function spawnStub(answer) {
	const calls = [];
	const spawnSync = (command, args) => {
		calls.push([command, ...args].join(" "));
		if (answer instanceof Error) throw answer;
		return answer;
	};
	return { spawnSync, calls };
}

/** A directory that both has a manifest and has been installed. */
const workspaceAt = () => true;

describe("workspace tooling readiness", () => {
	it("is ready when the manager actually runs something in the workspace", () => {
		const { spawnSync, calls } = spawnStub({ status: 0, stdout: "v22.19.0\n", stderr: "" });
		const measurement = measureWorkspaceTooling({
			cwd: "/w",
			packageManager: "pnpm",
			spawnSync,
			existsSync: workspaceAt,
		});

		expect(measurement.kind).toBe("ready");
		// It exercises the path real work takes — running something THROUGH the manager. `pnpm
		// --version` answers without ever consulting the workspace, so it cannot see this failure.
		expect(calls[0]).toMatch(/pnpm exec/u);
	});

	it("is broken when the manager refuses, and carries both what it said and the repair", () => {
		const { spawnSync } = spawnStub({
			status: 1,
			stdout: "",
			stderr: "ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY Aborted removal of modules directory",
		});
		const measurement = measureWorkspaceTooling({
			cwd: "/w",
			packageManager: "pnpm",
			spawnSync,
			existsSync: workspaceAt,
		});

		expect(measurement.kind).toBe("broken");
		expect(measurement.detail).toContain("ERR_PNPM_ABORTED");
		// pnpm's own advice here is to let it purge node_modules. The honest first move is an
		// install, and the operator should read that rather than the manager's suggestion.
		expect(measurement.repair).toBe("pnpm install");
	});

	it("cannot say when the manager is not on PATH — that is not a broken workspace", () => {
		const { spawnSync } = spawnStub(Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" }));
		const measurement = measureWorkspaceTooling({
			cwd: "/w",
			packageManager: "pnpm",
			spawnSync,
			existsSync: workspaceAt,
		});

		expect(measurement.kind).toBe("cannot-check");
		expect(measurement.detail).toContain("ENOENT");
	});

	it("cannot say where there is no workspace, and does not spawn to find out", () => {
		const { spawnSync, calls } = spawnStub({ status: 0, stdout: "", stderr: "" });
		const measurement = measureWorkspaceTooling({
			cwd: "/not-a-workspace",
			packageManager: "pnpm",
			spawnSync,
			existsSync: () => false,
		});

		expect(measurement.kind).toBe("cannot-check");
		expect(calls).toEqual([]);
	});

	it("cannot say where nothing was ever installed — that is not a workspace that broke", () => {
		const { spawnSync, calls } = spawnStub({ status: 1, stdout: "", stderr: "boom" });
		const measurement = measureWorkspaceTooling({
			cwd: "/fresh",
			packageManager: "pnpm",
			spawnSync,
			// A manifest, but no node_modules beside it.
			existsSync: (target) => String(target).endsWith("package.json"),
		});

		expect(measurement.kind).toBe("cannot-check");
		expect(measurement.detail).toMatch(/never been installed/u);
		// The verdict was already visible on the filesystem; spawning to reach it would be noise.
		expect(calls).toEqual([]);
	});

	it("carries the workspace it measured, in every state", () => {
		const states = [
			measureWorkspaceTooling({ cwd: "/a", packageManager: "pnpm", existsSync: () => false }),
			measureWorkspaceTooling({
				cwd: "/b",
				packageManager: "pnpm",
				existsSync: workspaceAt,
				spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
			}),
			measureWorkspaceTooling({
				cwd: "/c",
				packageManager: "pnpm",
				existsSync: workspaceAt,
				spawnSync: () => ({ status: 1, stdout: "", stderr: "nope" }),
			}),
		];
		// A measurement that does not know what it measured makes every consumer carry the subject
		// beside it, and the first mismatched pair reports a healthy directory as broken.
		expect(states.map((state) => state.workspace)).toEqual(["/a", "/b", "/c"]);
	});

	it("reads back as a sentence that names the repair, never as a bare state", () => {
		expect(
			describeWorkspaceTooling({
				kind: "broken",
				workspace: "/w",
				detail: "ERR_PNPM_ABORTED",
				repair: "pnpm install",
			}),
		).toMatch(/pnpm install/u);
		expect(
			describeWorkspaceTooling({ kind: "ready", workspace: "/w", probe: "pnpm exec node --version" }),
		).toMatch(/pnpm exec node --version/u);
		// "cannot check" must never read like "it is fine".
		const unknown = describeWorkspaceTooling({
			kind: "cannot-check",
			workspace: "/w",
			detail: "spawn pnpm ENOENT",
		});
		expect(unknown).toMatch(/could not|cannot/iu);
		expect(unknown).not.toMatch(/\bready\b/iu);
	});
});
