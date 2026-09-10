import { describe, expect, it, vi } from "vitest";
import { collectInspectBundle, createInspectCommand, knownEnvironmentSecrets } from "./inspect.js";

const SECRET = "super-secret-token";
const deps = {
	now: () => "2026-08-02T04:00:00.000Z",
	home: () => "/home/alice",
	cwd: () => "/home/alice/work/private",
	version: () => "0.1.0",
	platform: () => "linux",
	arch: () => "arm64",
	probeRuntime: async () => ({
		ready: false,
		url: "http://127.0.0.1:42001/efforts/summary",
		error: `Bearer ${SECRET} failed under /home/alice/work/private`,
	}),
	loadConfig: () => ({
		workspaces: { privateProject: { path: "/home/alice/private-project" } },
		surfaces: { web: {} },
		processes: { serve: {} },
	}),
	env: { FARM_TOKEN: SECRET },
};

describe("refarm inspect", () => {
	it("collects counts, never workspace names or paths, and sanitizes runtime errors", async () => {
		const bundle = await collectInspectBundle(deps);
		const text = JSON.stringify(bundle);
		for (const forbidden of [SECRET, "/home/alice", "privateProject", "private-project"]) {
			expect(text).not.toContain(forbidden);
		}
		expect(bundle.sections.find((section) => section.id === "declarations")?.data).toMatchObject({
			workspaces: 1,
			surfaces: 1,
			processes: 1,
		});
	});

	it("recognizes only secret-shaped environment keys", () => {
		expect(knownEnvironmentSecrets({ FARM_TOKEN: SECRET, HOME: "/home/alice", EMPTY_SECRET: "" })).toEqual([SECRET]);
	});

	it("exports a verified private file and states that nothing was uploaded", async () => {
		const write = vi.fn(async (_path: string, _content: string) => undefined);
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		await createInspectCommand({ ...deps, write }).parseAsync(
			["node", "script", "export", "--output", "support.json", "--json"],
		);
		expect(write).toHaveBeenCalledOnce();
		expect(write.mock.calls[0]?.[1]).not.toContain(SECRET);
		expect(stdout.mock.calls.map(([value]) => String(value)).join("")).toContain('"uploaded":false');
		stdout.mockRestore();
	});
});
