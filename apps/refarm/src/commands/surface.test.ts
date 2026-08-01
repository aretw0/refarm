import type { OperatorChannel, OperatorPrompt } from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveSurfaceGate, runSurfaceAdd } from "./surface.js";

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
