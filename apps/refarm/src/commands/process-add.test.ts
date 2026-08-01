import {
	createFileOperationTrail,
	undoOperationRecord,
	type OperationRecord,
} from "@refarm.dev/operation-consent-v1";
import {
	OperatorPromptCancelledError,
	type OperatorChannel,
	type OperatorPrompt,
} from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildProcessEntry,
	deriveRefarmInvocation,
	expandHome,
	parseCommandLine,
	processRestartPrompt,
	ProcessAddRefusal,
	resolveOnPath,
	runProcessAdd,
	WEB_SERVE_RECIPE,
	type ProcessAddDeps,
	type ProcessAddOptions,
	type ProcessAddResult,
	type RefarmInvocation,
} from "./process-add.js";
import { createProcessCommand } from "./process.js";

/**
 * `refarm process add` — held to the promise that makes a PROPOSAL safe to accept.
 *
 * `delivery add` had to interrogate; this does not, and the whole risk moves with that. A wizard
 * that derives is a wizard that can be wrong on the operator's behalf, so the assertions that
 * matter are:
 *
 *   1. every derived value is SHOWN with where it came from, before anything is written;
 *   2. the only thing asked is the thing that cannot be derived — and `restart` is asked EVERY
 *      time, because the contract refuses to guess it and a wizard may not guess on its behalf;
 *   3. the exact JSON is shown, the write happens only after an authorisation, and the recorded
 *      undo EXECUTES back to a byte-identical file;
 *   4. a re-run neither duplicates nor silently clobbers;
 *   5. the operator's own argv gets the care it deserves: a shell line is met with a QUESTION.
 *
 * Two of these are mutation-verified (the rule was broken in the source and the suite confirmed
 * red before the break was reverted): the undo (3) and never-defaulting `restart` (2).
 *
 * Every test drives a real filesystem under a throwaway root. Nothing here writes to
 * `~/.config/systemd`, and no `systemctl --user enable/start` is ever run.
 */

const NOW = "2026-07-31T12:00:00.000Z";
const EXISTING_CONFIG = `${JSON.stringify({ runtime: { autostart: "never" } }, null, 2)}\n`;
const LAUNCHER = "/home/op/.local/bin/refarm";
const INVOCATION: RefarmInvocation = {
	argv: [LAUNCHER],
	source: "REFARM_COMMAND — o launcher que te trouxe até aqui",
};

let root: string;
let announced: string[];

function testEnv(): NodeJS.ProcessEnv {
	return { ...process.env, SOVEREIGN_DIR: ".refarm", HOME: "/home/op" };
}

function configPath(): string {
	return path.join(root, ".refarm", "config.json");
}

function trailPath(): string {
	return path.join(root, ".refarm", "operations.json");
}

function readIfPresent(target: string): string | null {
	try {
		return fs.readFileSync(target, "utf-8");
	} catch {
		return null;
	}
}

function writeConfig(contents: string): void {
	fs.mkdirSync(path.join(root, ".refarm"), { recursive: true });
	fs.writeFileSync(configPath(), contents);
}

/** A channel that answers in order AND records what it was asked, so the phrasing, the prompt
 *  types and "was anything asked at all?" are all observable. */
function recordingChannel(answers: Array<boolean | string>): {
	channel: OperatorChannel;
	asked: OperatorPrompt[];
} {
	const queue = [...answers];
	const asked: OperatorPrompt[] = [];
	const ask = async (prompt: OperatorPrompt): Promise<boolean | string> => {
		asked.push(prompt);
		if (queue.length === 0) {
			throw new RangeError(`no scripted answer for: ${JSON.stringify(prompt.question)}`);
		}
		return queue.shift()!;
	};
	return { channel: { ask } as OperatorChannel, asked };
}

/** Ctrl+C / EOF at the Nth prompt — what a terminal actually produces. */
function cancellingChannel(after: number): { channel: OperatorChannel; asked: OperatorPrompt[] } {
	const answers = ["accept", "always", "authorize"];
	const asked: OperatorPrompt[] = [];
	const ask = async (prompt: OperatorPrompt): Promise<boolean | string> => {
		asked.push(prompt);
		if (asked.length > after) throw new OperatorPromptCancelledError();
		return answers[asked.length - 1]!;
	};
	return { channel: { ask } as OperatorChannel, asked };
}

let verified: Array<{ name: string; root: string }>;

function deps(channel: OperatorChannel, extra: Partial<ProcessAddDeps> = {}): ProcessAddDeps {
	return {
		root,
		env: testEnv(),
		interactive: true,
		operator: channel,
		now: () => NOW,
		decidedBy: "test-operator",
		host: "test-host",
		announce: (line) => void announced.push(line),
		invocation: INVOCATION,
		exists: () => true,
		verify: async (name, at) => {
			verified.push({ name, root: at });
			return [
				{
					name,
					state: "not-running",
					detail: "declared, no unit installed yet",
					backend: "systemd-user",
					supervised: false,
				},
			];
		},
		...extra,
	};
}

/** `deps` pins `interactive: true` so most tests never argue with the gate. The gate's own tests
 *  hand the decision back to it. */
function letTheGateDecide(base: ProcessAddDeps): ProcessAddDeps {
	const withoutIt = { ...base };
	delete (withoutIt as { interactive?: boolean }).interactive;
	return withoutIt;
}

/** The web-serve happy path's answers, in the order the wizard asks them. */
function fullRun(
	overrides: Partial<Record<"proposal" | "restart" | "decision", string>> = {},
): string[] {
	return [
		overrides.proposal ?? "accept",
		overrides.restart ?? "always",
		overrides.decision ?? "authorize",
	];
}

async function declareOnce(
	options: ProcessAddOptions = { name: "web-serve" },
	answers: Array<string | boolean> = fullRun(),
	extra: Partial<ProcessAddDeps> = {},
): Promise<{ result: ProcessAddResult; asked: OperatorPrompt[] }> {
	const { channel, asked } = recordingChannel(answers);
	const result = await runProcessAdd(options, deps(channel, extra));
	return { result, asked };
}

beforeEach(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "refarm-process-add-")));
	announced = [];
	verified = [];
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

// ── Derivation: propose, do not interrogate ───────────────────────────────────

describe("refarm process add — what refarm already knows, it does not ask", () => {
	it("proposes the whole web-serve entry from its own launcher, dist default and port", async () => {
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);

		expect(result.command).toEqual([
			LAUNCHER,
			"web",
			"serve",
			path.join(root, ".refarm", "dist", "farm-client"),
			"--port",
			"4321",
		]);
		expect(result.workingDirectory).toBe(root);
		expect(result.description).toContain("mesh distribution server");
	});

	it("SHOWS each derived value beside where it came from, before anything is written", async () => {
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error("expected declared");

		const keys = result.derived.map((field) => field.key);
		expect(keys).toEqual(["command", "directory", "port", "workingDirectory"]);
		// Provenance is the half that makes "authorise" a check rather than a leap of faith.
		expect(result.derived.find((f) => f.key === "command")?.source).toContain("REFARM_COMMAND");
		expect(result.derived.find((f) => f.key === "port")?.source).toContain(
			"assada em todo installer",
		);
		expect(result.derived.find((f) => f.key === "workingDirectory")?.source).toContain(
			"raiz soberana",
		);

		const shown = announced.join("\n");
		expect(shown).toContain("Isto é uma PROPOSTA");
		for (const field of result.derived) {
			expect(shown).toContain(field.value);
			expect(shown).toContain(field.source);
		}
	});

	it("asks ONLY what it cannot derive — one question, and it is `restart`", async () => {
		const { result, asked } = await declareOnce();
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.asked).toEqual(["restart"]);

		// Three prompts total: "use this proposal?", the restart question, the authorisation.
		expect(asked).toHaveLength(3);
		expect(asked[0]?.question).toContain("Uso esta proposta");
		expect(asked[1]?.question).toContain("volta sozinho");
		expect(asked[2]?.question).toContain("web-serve");
		// Nothing was asked about the command, the directory or the port.
		const questions = asked.map((prompt) => prompt.question).join("\n");
		expect(questions).not.toContain("Qual comando");
		expect(questions).not.toContain("Qual diretório");
		expect(questions).not.toContain("porta");
	});

	it("says so when the directory it would serve has not been published yet", async () => {
		await declareOnce({ name: "web-serve" }, fullRun(), { exists: () => false });
		const shown = announced.join("\n");
		expect(shown).toContain("ainda não existe");
		expect(shown).toContain("refarm dist publish");
	});

	it("derives the invocation from REFARM_COMMAND, then PATH, then the running process", () => {
		expect(deriveRefarmInvocation({ env: { REFARM_COMMAND: "/opt/bin/refarm" } })?.argv).toEqual([
			"/opt/bin/refarm",
		]);
		// A relative REFARM_COMMAND is not an answer a supervisor can use, so it is skipped.
		expect(
			deriveRefarmInvocation({
				env: { REFARM_COMMAND: "refarm", PATH: "/x/bin" },
				isExecutable: (candidate) => candidate === "/x/bin/refarm",
			})?.argv,
		).toEqual(["/x/bin/refarm"]);
		expect(
			deriveRefarmInvocation({
				env: {},
				execPath: "/usr/bin/node",
				entrypoint: "/srv/refarm/dist/index.js",
			})?.argv,
		).toEqual(["/usr/bin/node", "/srv/refarm/dist/index.js"]);
		// Nothing to derive from ⇒ null, and the wizard asks rather than inventing a path.
		expect(deriveRefarmInvocation({ env: {}, execPath: "node", entrypoint: null })).toBeNull();
	});

	it("walks PATH the way execvp does — a regular file with an executable bit", () => {
		expect(
			resolveOnPath("refarm", { PATH: "/a:/b" }, (candidate) => candidate === "/b/refarm"),
		).toBe("/b/refarm");
		expect(resolveOnPath("refarm", { PATH: "/a" }, () => false)).toBeNull();
		// A name with a slash is a path, not a lookup — searching for it would be wrong.
		expect(resolveOnPath("./refarm", { PATH: "/a" }, () => true)).toBeNull();
	});
});

// ── Adjusting: the "or edit" half ─────────────────────────────────────────────

describe("refarm process add — a proposal to authorise OR EDIT", () => {
	it("re-asks each derived value with the derived one already filled in, and re-derives", async () => {
		const { result, asked } = await declareOnce({ name: "web-serve" }, [
			"adjust",
			"/srv/kit",
			"8443",
			"always",
			"authorize",
		]);
		if (result.status !== "declared") throw new Error("expected declared");

		// The prompts carried the derived values as defaults — editing, not retyping.
		expect(asked[1]).toMatchObject({
			type: "text",
			default: path.join(root, ".refarm", "dist", "farm-client"),
		});
		expect(asked[2]).toMatchObject({ type: "text", default: "4321" });
		// And the command was RE-DERIVED from the answers rather than patched.
		expect(result.command).toEqual([LAUNCHER, "web", "serve", "/srv/kit", "--port", "8443"]);
		expect(result.asked).toEqual(["directory", "port", "restart"]);
	});

	it("a flag narrows the proposal, and the proposal says the flag is where it came from", async () => {
		const { result } = await declareOnce({ name: "web-serve", port: "9000", dir: "/srv/kit" });
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.command).toEqual([LAUNCHER, "web", "serve", "/srv/kit", "--port", "9000"]);
		expect(result.derived.find((f) => f.key === "port")?.source).toContain("--port");
		expect(result.derived.find((f) => f.key === "directory")?.source).toContain("--dir");
	});

	it("refuses a relative directory as a question about what a supervisor does", async () => {
		const { channel } = recordingChannel(["adjust", "dist/farm-client", "4321"]);
		await expect(runProcessAdd({ name: "web-serve" }, deps(channel))).rejects.toMatchObject({
			code: "process-add-relative-directory",
		});
		expect(readIfPresent(configPath())).toBeNull();
	});

	it("refuses a port that is not a port, from the arguments alone, before asking anything", async () => {
		const { channel, asked } = recordingChannel([]);
		await expect(
			runProcessAdd({ name: "web-serve", port: "no" }, deps(channel)),
		).rejects.toMatchObject({ code: "process-add-invalid-port" });
		expect(asked).toHaveLength(0);
	});
});

// ── The consent journey ───────────────────────────────────────────────────────

describe("refarm process add — the consent journey", () => {
	it("shows the exact JSON, the file and its current contents BEFORE writing anything", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce();
		expect(result.status).toBe("declared");

		const shown = announced.join("\n");
		expect(shown).toContain(configPath());
		expect(shown).toContain('"autostart": "never"');
		expect(shown).toContain('"web-serve": {');
		expect(shown).toContain('"restart": "always"');
		expect(shown).toContain('"command": [');
		expect(shown).toContain("Como fica");
		expect(shown).toContain("Desfazer");
		// The boundary, stated in the request itself: this DECLARES, it does not supervise.
		expect(shown).toContain("Nada é supervisionado ainda");
		expect(shown).toContain("refarm process install web-serve");
	});

	it("applies the authorised change and records it with an undo that EXECUTES", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);

		const written = JSON.parse(fs.readFileSync(configPath(), "utf-8")) as Record<string, unknown>;
		expect(written.processes).toEqual({
			"web-serve": {
				description: "the mesh distribution server devices bootstrap and farm-update from",
				command: [
					LAUNCHER,
					"web",
					"serve",
					path.join(root, ".refarm", "dist", "farm-client"),
					"--port",
					"4321",
				],
				workingDirectory: root,
				restart: "always",
			},
		});
		// The rest of the operator's config survived.
		expect(written.runtime).toEqual({ autostart: "never" });

		const trail = createFileOperationTrail(trailPath());
		const record = (await trail.read()).find(
			(entry) => entry.id === result.recordId,
		) as OperationRecord;
		expect(record).toBeDefined();
		expect(record.decision).toBe("authorized");
		expect(result.undoCommand).toContain("config history undo");
		expect(result.undoCommand).toContain("--local");

		// THE UNDO IS APPLIED HERE. A record whose undo is only described is a log.
		await undoOperationRecord({ record, trail, now: () => NOW });
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);
		const after = await trail.read();
		expect(after[after.length - 1]?.decision).toBe("undone");
	});

	it("creates the config file when there is none, and the undo removes it again", async () => {
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error("expected declared");
		expect(readIfPresent(configPath())).not.toBeNull();

		const trail = createFileOperationTrail(trailPath());
		const record = (await trail.read()).find(
			(entry) => entry.id === result.recordId,
		) as OperationRecord;
		await undoOperationRecord({ record, trail, now: () => NOW });
		expect(readIfPresent(configPath())).toBeNull();
	});

	it("declining changes NOTHING, and is remembered so it is not asked again", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce({ name: "web-serve" }, fullRun({ decision: "decline" }));
		expect(result.status).toBe("declined");
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);

		const records = await createFileOperationTrail(trailPath()).read();
		expect(records).toHaveLength(1);
		expect(records[0]?.decision).toBe("declined");
	});

	it("deferring writes nothing AND records nothing — the question comes back", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce({ name: "web-serve" }, fullRun({ decision: "later" }));
		expect(result.status).toBe("deferred");
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);
		expect(readIfPresent(trailPath())).toBeNull();
	});

	it.each([
		["at the proposal", 0],
		["at the restart question", 1],
		["at the authorisation itself", 2],
	])("cancelling %s leaves nothing half-written", async (_where, after) => {
		writeConfig(EXISTING_CONFIG);
		const { channel } = cancellingChannel(after);
		const result = await runProcessAdd({ name: "web-serve" }, deps(channel));
		expect(result.status).toBe("cancelled");
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);
		expect(readIfPresent(trailPath())).toBeNull();
	});
});

// ── restart: asked, never defaulted ───────────────────────────────────────────

describe("refarm process add — `restart` is asked, never defaulted", () => {
	it("asks it as a consequence, with no pre-answer", () => {
		const prompt = processRestartPrompt("web-serve");
		expect(prompt.question).toContain("volta sozinho");
		expect(prompt.question).not.toContain("restart");
		// NO DEFAULT. The contract refuses to guess this; a wizard may not guess on its behalf
		// through a UI affordance either.
		expect(prompt.default).toBeUndefined();
		expect(prompt.options.map((option) => option.value)).toEqual(["always", "on-failure", "never"]);
		for (const option of prompt.options)
			expect(option.description?.length ?? 0).toBeGreaterThan(20);
	});

	it("is asked on EVERY flag-free run, and the answer is what lands in the file", async () => {
		const { result, asked } = await declareOnce(
			{ name: "web-serve" },
			fullRun({ restart: "on-failure" }),
		);
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.restart).toBe("on-failure");
		expect(asked.some((prompt) => prompt.question.includes("volta sozinho"))).toBe(true);
		expect(result.asked).toContain("restart");
		const written = JSON.parse(fs.readFileSync(configPath(), "utf-8")) as {
			processes: Record<string, { restart: string }>;
		};
		expect(written.processes["web-serve"]?.restart).toBe("on-failure");
	});

	it("--restart replaces the QUESTION, never the answer", async () => {
		const { result, asked } = await declareOnce({ name: "web-serve", restart: "never" }, [
			"accept",
			"authorize",
		]);
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.restart).toBe("never");
		expect(asked.some((prompt) => prompt.question.includes("volta sozinho"))).toBe(false);
		// The authorisation is NOT replaced by any flag.
		expect(asked[asked.length - 1]?.question).toContain("web-serve");
	});

	it("refuses a --restart that is not a policy, before disturbing anyone", async () => {
		const { channel, asked } = recordingChannel([]);
		await expect(
			runProcessAdd({ name: "web-serve", restart: "sometimes" }, deps(channel)),
		).rejects.toMatchObject({ code: "process-add-invalid-restart" });
		expect(asked).toHaveLength(0);
	});

	it("the parser — not this wizard — is what makes an entry without it impossible", () => {
		expect(() =>
			buildProcessEntry({
				name: "web-serve",
				description: "x",
				command: ["/bin/true"],
				restart: undefined as never,
			}),
		).toThrow(/"restart" must be declared/);
	});
});

// ── The operator's own argv ───────────────────────────────────────────────────

describe("refarm process add — the command is the operator's own argv", () => {
	it("splits a line into an argv, honouring quotes", () => {
		expect(parseCommandLine("/usr/bin/node /srv/app.js --port 3000").argv).toEqual([
			"/usr/bin/node",
			"/srv/app.js",
			"--port",
			"3000",
		]);
		expect(parseCommandLine('/usr/bin/say "hello world"').argv).toEqual([
			"/usr/bin/say",
			"hello world",
		]);
	});

	it("notices a shell LINE — and does not notice a shell asked for out loud", () => {
		expect(parseCommandLine("cat x | wc -l").shellOperators).toContain("|");
		expect(parseCommandLine("a && b").shellOperators).toContain("&&");
		expect(parseCommandLine("a > out.log").shellOperators).toContain(">");
		expect(parseCommandLine("echo $(date)").shellOperators).toContain("$(");
		// Quoted: this is `/bin/sh -c` used deliberately, with the shell named in command[0]
		// where the operator can see it.
		expect(parseCommandLine('/bin/sh -c "a | b"').shellOperators).toEqual([]);
		expect(parseCommandLine('/bin/sh -c "a | b"').argv).toEqual(["/bin/sh", "-c", "a | b"]);
	});

	it("meets a shell string with a QUESTION, not a validation error after the fact", async () => {
		const { channel, asked } = recordingChannel([
			"my job", // description
			"tail -f /var/log/x | grep boom", // a shell line
			"/usr/bin/tail -f /var/log/x", // asked again, answered properly
			"/srv",
			"always",
			"authorize",
		]);
		const result = await runProcessAdd({ name: "tailer" }, deps(channel));
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);

		// It ASKED again rather than failing, and it explained what a supervisor actually does.
		const explanation = announced.join("\n");
		expect(explanation).toContain("linha de shell");
		expect(explanation).toContain("executa um PROGRAMA");
		expect(explanation).toContain('/bin/sh -c "…"');
		expect(asked.filter((prompt) => prompt.question.includes("Qual comando"))).toHaveLength(2);
		expect(result.command).toEqual(["/usr/bin/tail", "-f", "/var/log/x"]);
	});

	it("refuses rather than silently wrapping, when the shell line keeps coming back", async () => {
		const { channel } = recordingChannel(["job", "a | b", "c && d", "e ; f"]);
		await expect(runProcessAdd({ name: "shelly" }, deps(channel))).rejects.toMatchObject({
			code: "process-add-shell-command",
		});
		expect(readIfPresent(configPath())).toBeNull();
	});

	it("offers the absolute path for a bare name, and asks before using it", async () => {
		const { channel, asked } = recordingChannel([
			"my job",
			"mytool --serve",
			true, // yes, use /opt/bin/mytool
			"/srv",
			"always",
			"authorize",
		]);
		const result = await runProcessAdd(
			{ name: "tool" },
			deps(channel, {
				env: { ...testEnv(), PATH: "/opt/bin" },
				isExecutable: (candidate) => candidate === "/opt/bin/mytool",
			}),
		);
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);
		const confirm = asked.find((prompt) => prompt.type === "confirm");
		expect(confirm?.question).toContain("não procura no PATH");
		expect(confirm?.question).toContain("/opt/bin/mytool");
		expect(result.command).toEqual(["/opt/bin/mytool", "--serve"]);
	});

	it("refuses an unresolvable relative command by naming `command -v`", async () => {
		const { channel } = recordingChannel(["my job", "nowhere-tool --serve"]);
		await expect(
			runProcessAdd(
				{ name: "tool" },
				deps(channel, { env: { ...testEnv(), PATH: "/nope" }, isExecutable: () => false }),
			),
		).rejects.toMatchObject({ code: "process-add-relative-command" });
		expect(readIfPresent(configPath())).toBeNull();
	});

	it("expands a leading ~ the way the operator's shell would", () => {
		expect(expandHome("~/srv", { HOME: "/home/op" })).toBe("/home/op/srv");
		expect(expandHome("/srv", { HOME: "/home/op" })).toBe("/srv");
	});

	it("RESPECTS the parser's refusal of a shell string instead of routing around it", () => {
		expect(() =>
			buildProcessEntry({
				name: "web-serve",
				description: "x",
				command: "refarm web serve ." as unknown as string[],
				restart: "always",
			}),
		).toThrow(/must be an ARRAY of arguments, not a shell line/);
	});
});

// ── Re-running ────────────────────────────────────────────────────────────────

describe("refarm process add — re-running", () => {
	it("does not silently duplicate or clobber: it asks, and keeping is a successful outcome", async () => {
		await declareOnce();
		const beforeSecondRun = fs.readFileSync(configPath(), "utf-8");

		const { channel, asked } = recordingChannel([false]);
		const result = await runProcessAdd({ name: "web-serve" }, deps(channel));
		expect(result).toEqual({
			status: "unchanged",
			process: "web-serve",
			reason: "already-declared",
		});
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(beforeSecondRun);
		expect(asked[0]?.type).toBe("confirm");
		expect(asked[0]?.question).toContain("web-serve");
	});

	it("replaces in place when the operator says so — one entry, chained in the trail", async () => {
		const first = await declareOnce();
		if (first.result.status !== "declared") throw new Error("expected declared");

		const { channel } = recordingChannel([
			true, // yes, replace
			"accept",
			"on-failure",
			"authorize",
		]);
		const result = await runProcessAdd(
			{ name: "web-serve" },
			deps(channel, { now: () => "2026-08-01T00:00:00.000Z" }),
		);
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);
		expect(result.replaced).toBe(true);

		const written = JSON.parse(fs.readFileSync(configPath(), "utf-8")) as {
			processes: Record<string, Record<string, unknown>>;
		};
		// KEYED, so there is exactly one — a re-run cannot produce a duplicate.
		expect(Object.keys(written.processes)).toEqual(["web-serve"]);
		expect(written.processes["web-serve"]?.restart).toBe("on-failure");

		const records = await createFileOperationTrail(trailPath()).read();
		expect(records).toHaveLength(2);
		expect(records[1]?.revisitOf).toBe(records[0]?.id);
	});

	it("does not re-ask a standing decision by accident, even after a hand-removal", async () => {
		await declareOnce({ name: "web-serve" }, fullRun({ decision: "decline" }));
		const { channel, asked } = recordingChannel([false]);
		const result = await runProcessAdd({ name: "web-serve" }, deps(channel));
		expect(result).toEqual({
			status: "unchanged",
			process: "web-serve",
			reason: "already-decided",
		});
		expect(asked[0]?.question).toContain("declined");
	});

	it("reads a HAND-WRITTEN declaration as the input, rather than overwriting it", async () => {
		writeConfig(
			`${JSON.stringify(
				{
					processes: {
						"web-serve": { command: ["/usr/bin/true"], restart: "never" },
					},
				},
				null,
				2,
			)}\n`,
		);
		const before = fs.readFileSync(configPath(), "utf-8");
		const { channel } = recordingChannel([false]);
		const result = await runProcessAdd({ name: "web-serve" }, deps(channel));
		expect(result.status).toBe("unchanged");
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(before);
	});

	it("--replace skips the gate and re-opens the question directly", async () => {
		await declareOnce();
		const { channel, asked } = recordingChannel(fullRun());
		const result = await runProcessAdd({ name: "web-serve", replace: true }, deps(channel));
		expect(result.status).toBe("declared");
		expect(asked.some((prompt) => prompt.type === "confirm")).toBe(false);
	});
});

// ── Ending by verifying ───────────────────────────────────────────────────────

describe("refarm process add — ends by verifying, and hands over the activation", () => {
	it("reads the new entry back through the real `process status`", async () => {
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error("expected declared");
		expect(verified).toEqual([{ name: "web-serve", root }]);
		expect(result.statuses[0]?.name).toBe("web-serve");
	});

	it("hands over the activation path and runs NO systemctl", async () => {
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.installCommand).toBe("refarm process install web-serve");
		// Not "installed", not "enabled": DECLARED. The unit is `process install`'s to propose, and
		// starting it stays the operator's.
		expect(announced.join("\n")).not.toContain("systemctl --user enable");
	});

	it("the default verification is the real `process status`, not a claim in memory", async () => {
		// No `verify` injected: this exercises the lazily-imported default, which is the seam that
		// keeps this module out of an import cycle with the command that hosts it. Read-only —
		// `systemctl --user show` at worst, and nothing is written anywhere.
		const { channel } = recordingChannel(fullRun());
		const withoutVerify = deps(channel);
		delete (withoutVerify as { verify?: unknown }).verify;
		const result = await runProcessAdd({ name: "web-serve" }, withoutVerify);
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.statuses).toHaveLength(1);
		expect(result.statuses[0]?.name).toBe("web-serve");
		// Whatever this host can say, it is a real verdict about a DECLARED process — never the
		// "not declared" the same call returned one moment earlier.
		expect(result.statuses[0]?.state).not.toBe("not-declared");
	});
});

// ── No TTY ────────────────────────────────────────────────────────────────────

describe("refarm process add — with nobody to ask", () => {
	it("refuses instead of prompting, and instead of hanging", async () => {
		const { channel, asked } = recordingChannel([]);
		await expect(
			runProcessAdd({ name: "web-serve" }, deps(channel, { interactive: false })),
		).rejects.toBeInstanceOf(ProcessAddRefusal);
		expect(asked).toHaveLength(0);
		expect(readIfPresent(configPath())).toBeNull();
	});

	it("names hand-editing as the path that still works", async () => {
		const { channel } = recordingChannel([]);
		let refusal: ProcessAddRefusal | null = null;
		try {
			await runProcessAdd({ name: "web-serve" }, deps(channel, { interactive: false }));
		} catch (caught) {
			refusal = caught as ProcessAddRefusal;
		}
		expect(refusal?.code).toBe("process-add-not-interactive");
		expect(refusal?.message).toContain("by hand");
		expect(refusal?.message).toContain(configPath());
	});

	/**
	 * A publisher EXISTING is not evidence that anyone is attending — the lesson `delivery add`
	 * paid for in `f9a0ad4f`, reused here rather than re-learned. Being attended from elsewhere is
	 * DECLARED by the caller that knows it.
	 */
	it("asks when the caller declares it is attended elsewhere, with no terminal", async () => {
		const stdin = process.stdin as unknown as { isTTY?: boolean };
		const stdout = process.stdout as unknown as { isTTY?: boolean };
		const [wasIn, wasOut] = [stdin.isTTY, stdout.isTTY];
		stdin.isTTY = false;
		stdout.isTTY = false;
		try {
			const { channel } = recordingChannel(fullRun());
			const result = await runProcessAdd(
				{ name: "web-serve", attendedElsewhere: true },
				letTheGateDecide(deps(channel)),
			);
			expect(result.status).toBe("declared");
		} finally {
			stdin.isTTY = wasIn;
			stdout.isTTY = wasOut;
		}
	});

	it("still refuses when there is neither a terminal nor anywhere else", async () => {
		const stdin = process.stdin as unknown as { isTTY?: boolean };
		const stdout = process.stdout as unknown as { isTTY?: boolean };
		const [wasIn, wasOut] = [stdin.isTTY, stdout.isTTY];
		stdin.isTTY = false;
		stdout.isTTY = false;
		try {
			const { channel, asked } = recordingChannel([]);
			let refusal: ProcessAddRefusal | null = null;
			try {
				await runProcessAdd({ name: "web-serve" }, letTheGateDecide(deps(channel)));
			} catch (caught) {
				refusal = caught as ProcessAddRefusal;
			}
			expect(refusal?.code).toBe("process-add-not-interactive");
			expect(refusal?.message).toContain("nowhere to ask you");
			expect(asked).toHaveLength(0);
		} finally {
			stdin.isTTY = wasIn;
			stdout.isTTY = wasOut;
		}
	});
});

// ── The recipe, in isolation ──────────────────────────────────────────────────

describe("the web-serve recipe", () => {
	it("prefers the assembled kit directory, and falls back to the published root", () => {
		const kit = path.join("/farm", ".refarm", "dist", "farm-client");
		const proposed = WEB_SERVE_RECIPE.propose({
			root: "/farm",
			env: {},
			invocation: INVOCATION,
			exists: (target) => target === kit,
			overrides: {},
		});
		expect(proposed.command).toContain(kit);

		const fallback = WEB_SERVE_RECIPE.propose({
			root: "/farm",
			env: {},
			invocation: INVOCATION,
			exists: () => false,
			overrides: {},
		});
		expect(fallback.command).toContain(path.join("/farm", ".refarm", "dist"));
	});

	it("never proposes a restart policy — that is not a derivable fact", () => {
		const proposed = WEB_SERVE_RECIPE.propose({
			root: "/farm",
			env: {},
			invocation: INVOCATION,
			exists: () => true,
			overrides: {},
		});
		expect(proposed.derived.map((field) => field.key)).not.toContain("restart");
		expect(JSON.stringify(proposed)).not.toContain('"restart"');
	});
});

// ── The CLI surface ───────────────────────────────────────────────────────────

describe("refarm process — the command surface", () => {
	let originalCwd: string;
	let stdout: string[];

	beforeEach(() => {
		originalCwd = process.cwd();
		process.chdir(root);
		stdout = [];
		vi.spyOn(console, "log").mockImplementation((...args) => void stdout.push(args.join(" ")));
		vi.spyOn(console, "error").mockImplementation((...args) => void stdout.push(args.join(" ")));
	});

	afterEach(() => {
		process.chdir(originalCwd);
	});

	it("refuses `add` with the repo's envelope when there is no terminal, never a stack trace", async () => {
		await createProcessCommand().parseAsync(["add", "web-serve", "--json"], { from: "user" });
		const envelope = JSON.parse(stdout.join("\n")) as Record<string, unknown>;
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("process-add-not-interactive");
		expect(Array.isArray(envelope.nextCommands)).toBe(true);
		expect(process.exitCode).toBe(1);
		expect(stdout.join("\n")).not.toContain("    at ");
	});
});
