import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	describeScheduledWorkSources,
	formatScheduledWorkSources,
} from "./scheduled-work-sources.js";

let root: string;

function write(relative: string, contents: string): string {
	const full = path.join(root, relative);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, contents);
	return full;
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "refarm-sources-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("describeScheduledWorkSources", () => {
	it("names the file it would have read even when there is none", () => {
		const base = path.join(root, "node-base");
		mkdirSync(base, { recursive: true });
		const [node] = describeScheduledWorkSources({ base, cwd: base });
		expect(node?.state).toBe("absent");
		// THE PATH IS REPORTED ANYWAY. "watching nothing" and "nothing to watch" print the same
		// summary; the difference is which file was looked at, so the file is always named.
		expect(node?.path).toBe(path.join(base, ".refarm/automations.json"));
	});

	it("counts declared and active separately", () => {
		const base = path.join(root, "node-base");
		write(
			"node-base/.refarm/automations.json",
			JSON.stringify({
				automations: [
					{ id: "a", name: "a", status: "active", triggers: [{ type: "manual" }] },
					{ id: "b", name: "b", status: "draft", triggers: [{ type: "manual" }] },
					{ id: "c", name: "c", status: "archived", triggers: [{ type: "manual" }] },
				],
			}),
		);
		const [node] = describeScheduledWorkSources({ base, cwd: base });
		expect(node?.state).toBe("present");
		// THREE DECLARED, ONE ACTIVE. Before this, a tick over these three reported all zeros —
		// identical to a directory with no automations at all.
		expect(node?.declared).toBe(3);
		expect(node?.active).toBe(1);
	});

	it("distinguishes a malformed document from an absent one", () => {
		const base = path.join(root, "node-base");
		write("node-base/.refarm/automations.json", "{ this is not json");
		const [node] = describeScheduledWorkSources({ base, cwd: base });
		// The adapter's own loader folds these two into `undefined`, which is exactly the blind
		// spot this describer must not inherit.
		expect(node?.state).toBe("unreadable");
		expect(node?.reason).toBeTruthy();
	});

	it("reports the project file found by walking up, not a guess", () => {
		const project = path.join(root, "tree");
		const deep = path.join(project, "packages", "inner");
		mkdirSync(deep, { recursive: true });
		const file = write("tree/.project/automations.json", JSON.stringify({ automations: [] }));
		const [, projectSource] = describeScheduledWorkSources({
			base: path.join(root, "node-base"),
			cwd: deep,
		});
		expect(projectSource?.path).toBe(file);
		expect(projectSource?.state).toBe("present");
	});

	it("says so plainly when no project tree was found at all", () => {
		const base = path.join(root, "node-base");
		mkdirSync(base, { recursive: true });
		const [, projectSource] = describeScheduledWorkSources({ base, cwd: base });
		expect(projectSource?.path).toBeNull();
		expect(projectSource?.state).toBe("absent");
	});
});

describe("formatScheduledWorkSources", () => {
	it("carries what was read into one line a journal can hold", () => {
		const base = path.join(root, "node-base");
		write(
			"node-base/.refarm/automations.json",
			JSON.stringify({
				automations: [{ id: "a", name: "a", status: "active", triggers: [{ type: "manual" }] }],
			}),
		);
		const line = formatScheduledWorkSources(describeScheduledWorkSources({ base, cwd: base }));
		expect(line).toContain("node: 1 declared, 1 active");
		expect(line).toContain(".refarm/automations.json");
	});
});
