import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { afterEach, describe, expect, it } from "vitest";

import { collectSealedFiles, createNodeCommand } from "./node.js";

const homes: string[] = [];

function syntheticHome(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-node-"));
	homes.push(home);
	fs.mkdirSync(path.join(home, ".refarm", "tls"), { recursive: true });
	fs.writeFileSync(
		path.join(home, ".refarm", "config.json"),
		JSON.stringify({ node: { name: "n1" }, surfaces: { web: { port: 3000 } } }),
	);
	fs.writeFileSync(path.join(home, ".refarm", "node-id"), "node-1");
	fs.writeFileSync(path.join(home, ".refarm", "tls", "ca.key"), "PRIVATE-CA-KEY");
	fs.writeFileSync(path.join(home, ".refarm", "tls", "ca.crt"), "PUBLIC-CA-CERT");
	return home;
}

afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

describe("collectSealedFiles", () => {
	it("collects identity and its key, and nothing that is a decision", () => {
		const home = syntheticHome();
		const collected = collectSealedFiles(home)
			.map((file) => file.relative)
			.sort();
		expect(collected).toEqual([".refarm/node-id", ".refarm/tls/ca.crt", ".refarm/tls/ca.key"]);
	});
});

describe("node declare", () => {
	it("previews without a passphrase and without writing anything", async () => {
		// The read-only half, and the reason this command can be probed at all: a preview that
		// demanded a passphrase could not run unattended, and a node whose declaration cannot be
		// inspected before it is sealed is a node the operator must trust blindly.
		//
		// The EMPTY answer queue is the assertion. `createScriptedOperatorChannel` throws
		// `RangeError: answer queue exhausted` on any `ask`, so a preview that ever prompted would
		// fail here rather than pass quietly.
		const home = syntheticHome();
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel([]),
		);
		await command.parseAsync(["declare", "--json"], { from: "user" });
		expect(fs.readdirSync(home)).toEqual([".refarm"]);
	});

	it("REFUSES to declare while the layout does not describe some path", async () => {
		// The self-correcting half of the layout, carried into this command. An unregistered path
		// means a subsystem writes somewhere nobody described, which is exactly how a certificate
		// authority key sat unnoticed. Sealing a declaration while that is true would bless the gap.
		const home = syntheticHome();
		fs.mkdirSync(path.join(home, ".refarm", "nobody-declared-this"), { recursive: true });
		fs.writeFileSync(path.join(home, ".refarm", "nobody-declared-this", "x.json"), "{}");
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel(["pw", "pw"]),
		);
		await expect(
			command.parseAsync(["declare", "--out", target, "--json"], { from: "user" }),
		).rejects.toThrow(/unregistered/iu);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("asks for the passphrase TWICE before sealing", async () => {
		// A typo at seal time makes the file permanently unopenable, and the operator would not learn
		// it until the day he needs it. Confirmation is the only moment the mistake is still free.
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const channel = createScriptedOperatorChannel(["hunter2", "hunter2"]);
		const command = createNodeCommand(
			() => home,
			() => channel,
		);
		await command.parseAsync(["declare", "--out", target, "--json"], { from: "user" });
		expect(fs.existsSync(target)).toBe(true);
	});

	it("refuses when the two passphrases differ, and writes NOTHING", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel(["a", "b"]),
		);
		await expect(
			command.parseAsync(["declare", "--out", target, "--json"], { from: "user" }),
		).rejects.toThrow(/did not match/iu);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("writes a file whose cleartext holds the decisions and NONE of the key bytes", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel(["pw", "pw"]),
		);
		await command.parseAsync(["declare", "--out", target, "--json"], { from: "user" });
		const written = fs.readFileSync(target, "utf8");
		expect(written).toContain('"port": 3000');
		expect(written).not.toContain("PRIVATE-CA-KEY");
		expect(written).not.toContain("PUBLIC-CA-CERT");
	});

	it("refuses to overwrite an existing declaration without --force", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		fs.writeFileSync(target, "{}");
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel(["pw", "pw"]),
		);
		await expect(
			command.parseAsync(["declare", "--out", target, "--json"], { from: "user" }),
		).rejects.toThrow(/--force/u);
		expect(fs.readFileSync(target, "utf8")).toBe("{}");
	});
});

/** Declare a home into a file, so the diff and apply suites start from a real sealed artefact. */
async function declaredFile(home: string): Promise<string> {
	const target = path.join(home, "declared.json");
	const command = createNodeCommand(
		() => home,
		() => createScriptedOperatorChannel(["pw", "pw"]),
	);
	await command.parseAsync(["declare", "--out", target, "--json"], { from: "user" });
	return target;
}

describe("node diff", () => {
	it("reports aligned when nothing changed since the declaration", async () => {
		const home = syntheticHome();
		const file = await declaredFile(home);
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel([]),
		);
		await command.parseAsync(["diff", file, "--json"], { from: "user" });
		expect(process.exitCode ?? 0).toBe(0);
	});

	it("reports divergence after the node's config changes, and EXITS NON-ZERO", async () => {
		// A diff that exits 0 on divergence cannot be a gate, and Slice 2 wires exactly this into
		// `agent finish` so a declaration cannot go stale in silence.
		const home = syntheticHome();
		const file = await declaredFile(home);
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ node: { name: "n1" }, surfaces: { web: { port: 4000 } } }),
		);
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel([]),
		);
		await command.parseAsync(["diff", file, "--json"], { from: "user" });
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});

	it("says UNCOMPARABLE rather than aligned when the seal is a custody it cannot open", async () => {
		const home = syntheticHome();
		const file = await declaredFile(home);
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		fs.writeFileSync(file, JSON.stringify({ ...parsed, seal: { ...parsed.seal, custody: "peer" } }));
		const command = createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel([]),
		);
		await command.parseAsync(["diff", file, "--json"], { from: "user" });
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});
});
