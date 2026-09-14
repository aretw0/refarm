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

/** A home with no `.refarm` at all — the machine after the reformat. */
function emptyHome(): string {
	const home = syntheticHome();
	fs.rmSync(path.join(home, ".refarm"), { recursive: true, force: true });
	return home;
}

/**
 * Drive the command the way the operator does, and capture what he sees.
 *
 * Asserting on the REFUSAL rather than on a thrown error is deliberate: since the refusal guard
 * landed, an invalid input prints a named message and sets a non-zero exit code instead of letting
 * an exception escape `parseAsync`. `.rejects.toThrow()` would now pass for the wrong reason (it
 * would not), and would stop testing anything the operator experiences.
 */
async function runNode(
	home: string,
	answers: Array<string | boolean>,
	argv: string[],
): Promise<{ out: string; exitCode: number }> {
	const chunks: string[] = [];
	const write = process.stdout.write.bind(process.stdout);
	const consoleError = console.error;
	// `console.log` TOO, and it is not redundant: `printJson` goes through it, so the JSON refusal
	// envelope — the thing every `--json` assertion below reads — is invisible to a capture that
	// only replaces `process.stdout.write`.
	const consoleLog = console.log;
	const collect = (...args: unknown[]) => {
		chunks.push(args.map(String).join(" "));
	};
	process.stdout.write = ((chunk: string) => {
		chunks.push(String(chunk));
		return true;
	}) as never;
	console.error = collect;
	console.log = collect;
	process.exitCode = 0;
	try {
		await createNodeCommand(
			() => home,
			() => createScriptedOperatorChannel(answers),
		).parseAsync(argv, { from: "user" });
	} finally {
		process.stdout.write = write;
		console.error = consoleError;
		console.log = consoleLog;
	}
	const exitCode = Number(process.exitCode ?? 0);
	process.exitCode = 0;
	return { out: chunks.join(""), exitCode };
}

/** Declare a home into a file, so the diff and apply suites start from a real sealed artefact. */
async function declaredFile(home: string): Promise<string> {
	const target = path.join(home, "declared.json");
	const { exitCode } = await runNode(home, ["pw", "pw"], ["declare", "--out", target, "--json"]);
	expect(exitCode).toBe(0);
	return target;
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
		// The EMPTY answer queue is the assertion. `createScriptedOperatorChannel` throws on any
		// `ask`, so a preview that ever prompted would refuse here rather than pass quietly.
		const home = syntheticHome();
		const { exitCode } = await runNode(home, [], ["declare", "--json"]);
		expect(exitCode).toBe(0);
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
		const { out, exitCode } = await runNode(
			home,
			["pw", "pw"],
			["declare", "--out", target, "--json"],
		);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/unregistered/iu);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("asks for the passphrase TWICE before sealing", async () => {
		// A typo at seal time makes the file permanently unopenable, and the operator would not learn
		// it until the day he needs it. Confirmation is the only moment the mistake is still free.
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const { exitCode } = await runNode(
			home,
			["hunter2", "hunter2"],
			["declare", "--out", target, "--json"],
		);
		expect(exitCode).toBe(0);
		expect(fs.existsSync(target)).toBe(true);
	});

	it("refuses when the two passphrases differ, and writes NOTHING", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		const { out, exitCode } = await runNode(home, ["a", "b"], ["declare", "--out", target, "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/did not match/iu);
		expect(fs.existsSync(target)).toBe(false);
	});

	it("writes a file whose cleartext holds the decisions and NONE of the key bytes", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		await runNode(home, ["pw", "pw"], ["declare", "--out", target, "--json"]);
		const written = fs.readFileSync(target, "utf8");
		expect(written).toContain('"port": 3000');
		expect(written).not.toContain("PRIVATE-CA-KEY");
		expect(written).not.toContain("PUBLIC-CA-CERT");
	});

	it("refuses to overwrite an existing declaration without --force", async () => {
		const home = syntheticHome();
		const target = path.join(home, "declared.json");
		fs.writeFileSync(target, "{}");
		const { out, exitCode } = await runNode(
			home,
			["pw", "pw"],
			["declare", "--out", target, "--json"],
		);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/--force/u);
		expect(fs.readFileSync(target, "utf8")).toBe("{}");
	});
});

describe("node diff", () => {
	it("reports aligned when nothing changed since the declaration", async () => {
		const home = syntheticHome();
		const file = await declaredFile(home);
		expect((await runNode(home, [], ["diff", file, "--json"])).exitCode).toBe(0);
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
		expect((await runNode(home, [], ["diff", file, "--json"])).exitCode).toBe(1);
	});

	it("says UNCOMPARABLE rather than aligned when the seal is a custody it cannot open", async () => {
		const home = syntheticHome();
		const file = await declaredFile(home);
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		fs.writeFileSync(file, JSON.stringify({ ...parsed, seal: { ...parsed.seal, custody: "peer" } }));
		const { out, exitCode } = await runNode(home, [], ["diff", file, "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toContain("uncomparable");
	});

	it("REFUSES a file that is not a declaration instead of crashing", async () => {
		// `test/architecture/cli-refusal-conformance.test.ts` probes exactly this and caught this file
		// on 2026-08-13. A stack trace tells the operator refarm broke; what happened is that he
		// pointed at the wrong path.
		const home = syntheticHome();
		const { out, exitCode } = await runNode(home, [], ["diff", "/nope/not-here.json", "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/not a readable declaration/iu);
	});
});

describe("node apply", () => {
	it("restores decisions AND identity onto an empty home", async () => {
		const file = await declaredFile(syntheticHome());
		const fresh = emptyHome();
		const { exitCode } = await runNode(fresh, ["pw"], ["apply", file, "--yes", "--json"]);
		expect(exitCode).toBe(0);
		expect(
			JSON.parse(fs.readFileSync(path.join(fresh, ".refarm", "config.json"), "utf8")),
		).toMatchObject({ surfaces: { web: { port: 3000 } } });
		expect(fs.readFileSync(path.join(fresh, ".refarm", "tls", "ca.key"), "utf8")).toBe(
			"PRIVATE-CA-KEY",
		);
	});

	it("refuses a wrong passphrase and leaves the target UNTOUCHED", async () => {
		// Unsealed BEFORE anything is written. A half-applied node is worse than an untouched one:
		// it looks configured and its identity is missing.
		const file = await declaredFile(syntheticHome());
		const fresh = emptyHome();
		const { out, exitCode } = await runNode(fresh, ["wrong"], ["apply", file, "--yes", "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/passphrase/iu);
		expect(fs.existsSync(path.join(fresh, ".refarm", "config.json"))).toBe(false);
	});

	it("REFUSES a declaration naming a path outside the home, and writes NOTHING", async () => {
		// Found by the commit security review, 2026-08-13. The keys inside the seal come from a FILE,
		// and this whole feature exists so that file can travel between machines. `path.join(home,
		// "../../.ssh/authorized_keys")` resolves happily. The seal proves the file was not altered
		// after sealing and proves NOTHING about who sealed it.
		//
		// The escape is placed second on purpose: every destination is checked before the first write,
		// so a declaration with one bad entry writes nothing rather than everything up to it.
		const source = syntheticHome();
		const file = await declaredFile(source);
		const escapeTarget = path.join(source, "ESCAPED");
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		const { sealPayload } = await import("./node-seal.js");
		fs.writeFileSync(
			file,
			JSON.stringify({
				...parsed,
				seal: sealPayload(
					{
						files: {
							".refarm/node-id": Buffer.from("innocent").toString("base64"),
							[`../${path.basename(source)}/ESCAPED`]: Buffer.from("owned").toString("base64"),
						},
					},
					"pw",
				),
			}),
		);
		const fresh = emptyHome();
		const { out, exitCode } = await runNode(fresh, ["pw"], ["apply", file, "--yes", "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/outside this node's home/iu);
		expect(fs.existsSync(escapeTarget)).toBe(false);
		expect(fs.existsSync(path.join(fresh, ".refarm", "node-id"))).toBe(false);
	});

	it("does not write without --yes or a confirmation", async () => {
		// CLAUDE.md section 8: no silent high-impact action. `apply` overwrites the operator's live
		// declarations, which is exactly the class that must be confirmed.
		//
		// ONE answer in the queue, and it is the confirmation. The passphrase is never asked for
		// because the refusal happens first — if that order ever inverts, this fails with "answer
		// queue exhausted" instead of passing while the operator types a secret for an operation he
		// already declined.
		const file = await declaredFile(syntheticHome());
		const fresh = emptyHome();
		const { exitCode } = await runNode(fresh, [false], ["apply", file, "--json"]);
		expect(exitCode).toBe(0);
		expect(fs.existsSync(path.join(fresh, ".refarm", "config.json"))).toBe(false);
	});

	it("names replication as NOT DONE when no peer answered, and points at the escape hatch", async () => {
		// The operator has one node. "Data replicates through the mesh" is true of the design and
		// false of his machine today, and a command that stayed quiet about it would be claiming a
		// completeness that does not exist.
		const file = await declaredFile(syntheticHome());
		const fresh = emptyHome();
		const { out } = await runNode(fresh, ["pw"], ["apply", file, "--yes"]);
		expect(out).toMatch(/not replicated/iu);
		expect(out).toContain("refarm backup create");
	});
});
