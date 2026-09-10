import type { OperatorChannel, OperatorPrompt } from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSurfaceCommand, deriveSurfaceGate, runSurfaceAdd } from "./surface.js";

let root: string;

function channel(answers: Array<string | boolean>): OperatorChannel {
	const queue = [...answers];
	return {
		async ask(_prompt: OperatorPrompt): Promise<string | boolean> {
			const answer = queue.shift();
			if (answer === undefined) throw new Error("unexpected prompt");
			return answer;
		},
	} as OperatorChannel;
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-surface-add-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("refarm surface add", () => {
	it.each([
		["sidecar-http", "device-token"],
		["daemon-ws", "device-token"],
		["web", "none"],
		["capabilities", "none"],
	])("derives only the gate %s can enforce", (name, expected) => {
		expect(deriveSurfaceGate(name)).toBe(expected);
	});

	it("shows and authorizes the exact canonical declaration", async () => {
		const announced: string[] = [];
		const result = await runSurfaceAdd(
			{ name: "sidecar-http", expose: "tailnet" },
			{
				root,
				interactive: true,
				operator: channel(["authorize"]),
				announce: (line) => announced.push(line),
				now: () => "2026-08-01T12:00:00.000Z",
				decidedBy: "test-operator",
				host: "test-host",
			},
		);
		expect(result.status).toBe("declared");
		expect(announced.join("\n")).toContain('"gate": "device-token"');
		expect(JSON.parse(fs.readFileSync(path.join(root, ".refarm", "config.json"), "utf8"))).toMatchObject({
			surfaces: { "sidecar-http": { expose: "tailnet", gate: "device-token" } },
		});
	});

	it("refuses a gate the named surface cannot enforce before writing", async () => {
		await expect(runSurfaceAdd(
			{ name: "web", expose: "tailnet", gate: "device-token" },
			{ root, interactive: true, operator: channel([]) },
		)).rejects.toThrow("verifies no bearer credential");
		expect(fs.existsSync(path.join(root, ".refarm", "config.json"))).toBe(false);
	});

	it("refuses an invalid sibling before rewriting the existing config", async () => {
		const configPath = path.join(root, ".refarm", "config.json");
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		const before = '{"surfaces":{"unknown":{"expose":"loopback"}}}\n';
		fs.writeFileSync(configPath, before);
		await expect(
			runSurfaceAdd(
				{ name: "web", expose: "loopback" },
				{ root, interactive: true, operator: channel([]) },
			),
		).rejects.toThrow("not a surface any refarm runtime declares");
		expect(fs.readFileSync(configPath, "utf8")).toBe(before);
	});
});

describe("refarm surface list", () => {
	// DECLARES the base; it used to `process.chdir(root)` and expect the answer to follow.
	//
	// `surface list` resolves from `declaredBase()`, and rightly: surfaces are how the NODE
	// exposes itself to the network, so the answer belongs to the node, not to whichever
	// directory the operator happens to stand in. Once the suite grew a throwaway HOME
	// (vitest.setup.ts's Layer 0), `declaredBase()` correctly stopped following the cwd and this
	// assertion started failing — the test was pinning the behaviour the codebase is spending
	// this whole burn-down removing. Same lesson the Rust `CwdGuard` taught in the commit before
	// this one: a test that declares its base by walking into a directory is testing THROUGH the
	// defect.
	it("names the sovereign root and config path in its machine-readable result", async () => {
		const priorBase = process.env.SOVEREIGN_BASE;
		const lines: string[] = [];
		const log = console.log;
		try {
			process.env.SOVEREIGN_BASE = root;
			console.log = (line?: unknown) => lines.push(String(line));
			await createSurfaceCommand().parseAsync(["node", "surface", "list", "--json"]);
		} finally {
			console.log = log;
			if (priorBase === undefined) delete process.env.SOVEREIGN_BASE;
			else process.env.SOVEREIGN_BASE = priorBase;
		}
		const payload = JSON.parse(lines.join("\n"));
		expect(payload).toMatchObject({
			root,
			configPath: path.join(root, ".refarm", "config.json"),
			surfaces: [],
		});
	});
});
