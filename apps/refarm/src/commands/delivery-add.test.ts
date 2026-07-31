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
import { createDeliveryCommand } from "./delivery-command.js";
import {
	buildDeliveryEntry,
	deliveryCapabilityPrompt,
	deliveryTokenRelativePath,
	deliveryUnattendedPrompt,
	DeliveryAddRefusal,
	runDeliveryAdd,
	type DeliveryAddDeps,
	type DeliveryAddOptions,
	type DeliveryAddResult,
} from "./delivery-add.js";

/**
 * `refarm delivery add` — the wizard held to the promises that make it safe to have one.
 *
 * The whole risk of "declaring is authoring" is that a guided path becomes a path that writes
 * things the operator did not authorise, or writes a secret somewhere durable. So the assertions
 * that matter here are negative ones, and two of them are MUTATION-VERIFIED (breaking the rule in
 * the source must turn a test red — see the design doc's "how these are held" section):
 *
 *   1. the token never reaches `.refarm/config.json`, the operation trail, or any printed line;
 *   2. a run that is cancelled or declined leaves NOTHING half-written.
 *
 * Every test drives a real filesystem under a throwaway root — the file permissions, the JSON
 * bytes and the undo are the subject, and a mocked fs would assert the mock.
 */

const SECRET = "8123456789:AA-this-token-must-never-be-written-anywhere-but-its-own-file";
const NOW = "2026-07-31T12:00:00.000Z";
const EXISTING_CONFIG = `${JSON.stringify({ runtime: { autostart: "never" } }, null, 2)}\n`;

let root: string;
let announced: string[];

function testEnv(): NodeJS.ProcessEnv {
	return { ...process.env, SOVEREIGN_DIR: ".refarm" };
}

function configPath(): string {
	return path.join(root, ".refarm", "config.json");
}

function trailPath(): string {
	return path.join(root, ".refarm", "operations.json");
}

function tokenPath(name = "telegram"): string {
	return path.join(root, ".refarm", "delivery", `${name}.token`);
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

/** A channel that cancels — exactly what Ctrl+C / EOF produces at a terminal prompt. */
function cancellingChannel(after: number): { channel: OperatorChannel; asked: OperatorPrompt[] } {
	const answers = ["telegram", "123456789", "answer", "true", SECRET, "authorize"];
	const asked: OperatorPrompt[] = [];
	const ask = async (prompt: OperatorPrompt): Promise<boolean | string> => {
		asked.push(prompt);
		if (asked.length > after) throw new OperatorPromptCancelledError();
		return answers[asked.length - 1]!;
	};
	return { channel: { ask } as OperatorChannel, asked };
}

function deps(channel: OperatorChannel, extra: Partial<DeliveryAddDeps> = {}): DeliveryAddDeps {
	return {
		root,
		env: testEnv(),
		interactive: true,
		operator: channel,
		now: () => NOW,
		decidedBy: "test-operator",
		host: "test-host",
		announce: (line) => void announced.push(line),
		...extra,
	};
}

/** The happy path's answers, in the order the wizard asks them. */
function fullRun(
	overrides: Partial<
		Record<"name" | "chatId" | "capability" | "unattended" | "token" | "decision", string>
	> = {},
): string[] {
	return [
		overrides.name ?? "telegram",
		overrides.chatId ?? "123456789",
		overrides.capability ?? "answer",
		overrides.unattended ?? "true",
		overrides.token ?? SECRET,
		overrides.decision ?? "authorize",
	];
}

async function declareOnce(
	options: DeliveryAddOptions = {},
	answers: string[] = fullRun(),
): Promise<{ result: DeliveryAddResult; asked: OperatorPrompt[] }> {
	const { channel, asked } = recordingChannel(answers);
	const result = await runDeliveryAdd(options, deps(channel));
	return { result, asked };
}

beforeEach(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "refarm-delivery-add-")));
	announced = [];
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

// ── R2 — the operator authorises a specific diff ──────────────────────────────

describe("refarm delivery add — the consent journey", () => {
	it("shows the exact JSON, the file, and its current contents BEFORE writing anything", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce();
		expect(result.status).toBe("declared");

		const shown = announced.join("\n");
		// The file it will write, named.
		expect(shown).toContain(configPath());
		// Its CURRENT contents — not a summary of them.
		expect(shown).toContain('"autostart": "never"');
		// The exact entry, key by key, as it will appear on disk.
		expect(shown).toContain('"telegram": {');
		expect(shown).toContain('"adapter": "telegram"');
		expect(shown).toContain('"capability": "answer"');
		expect(shown).toContain('"unattended": true');
		expect(shown).toContain('"chatId": "123456789"');
		expect(shown).toContain('"tokenFile": ".refarm/delivery/telegram.token"');
		// And how the file ends up.
		expect(shown).toContain("Como fica");
		expect(shown).toContain("Desfazer");
	});

	it("applies the authorised change and records it with an undo that EXECUTES", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);

		const written = JSON.parse(fs.readFileSync(configPath(), "utf-8")) as Record<string, unknown>;
		expect(written.delivery).toEqual({
			telegram: {
				adapter: "telegram",
				capability: "answer",
				unattended: true,
				chatId: "123456789",
				tokenFile: ".refarm/delivery/telegram.token",
			},
		});
		// The rest of the operator's config survived.
		expect(written.runtime).toEqual({ autostart: "never" });

		// The record is real, and it is the one the operator is told to undo with.
		const trail = createFileOperationTrail(trailPath());
		const records = await trail.read();
		const record = records.find((entry) => entry.id === result.recordId) as OperationRecord;
		expect(record).toBeDefined();
		expect(record.decision).toBe("authorized");
		expect(record.undo.kind).toBe("restore-snapshot");
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
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);
		expect(readIfPresent(configPath())).not.toBeNull();

		const trail = createFileOperationTrail(trailPath());
		const record = (await trail.read()).find(
			(entry) => entry.id === result.recordId,
		) as OperationRecord;
		await undoOperationRecord({ record, trail, now: () => NOW });
		expect(readIfPresent(configPath())).toBeNull();
	});

	it("ends by VERIFYING with the real router, read back from disk", async () => {
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.route.answerable).toBe(true);
		expect(result.route.routes).toEqual([
			{ channel: "telegram", adapter: "telegram", mode: "answer" },
		]);
	});

	it("shows an attended-only declaration refusing to reach an operator who is away", async () => {
		const { result } = await declareOnce({}, fullRun({ unattended: "false" }));
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.unattended).toBe(false);
		expect(result.route.answerable).toBe(false);
		expect(JSON.stringify(result.route.refusals)).toContain("attended-only");
	});
});

// ── The token ─────────────────────────────────────────────────────────────────

describe("refarm delivery add — the token", () => {
	it("never reaches the config, the trail, or any printed line", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result, asked } = await declareOnce();
		expect(result.status).toBe("declared");

		const config = fs.readFileSync(configPath(), "utf-8");
		expect(config).not.toContain(SECRET);
		// Not merely absent by luck: the declaration names a FILE.
		expect(config).toContain('"tokenFile"');
		expect(config).not.toContain('"token"');
		expect(config).not.toContain("botToken");

		// The durable trail is a durable place; a secret may not live in one.
		expect(fs.readFileSync(trailPath(), "utf-8")).not.toContain(SECRET);

		// Nothing printed, ever.
		expect(announced.join("\n")).not.toContain(SECRET);

		// And it was asked for WITHOUT echo.
		const secretPrompt = asked.find((prompt) => prompt.type === "secret");
		expect(secretPrompt).toBeDefined();
	});

	it("writes the token to its own file at 0600", async () => {
		const { result } = await declareOnce();
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.tokenFile).toBe(tokenPath());
		expect(fs.readFileSync(tokenPath(), "utf-8").trim()).toBe(SECRET);
		expect(fs.statSync(tokenPath()).mode & 0o777).toBe(0o600);
	});

	it("re-permissions an existing token file rather than inheriting what it had", async () => {
		fs.mkdirSync(path.dirname(tokenPath()), { recursive: true });
		fs.writeFileSync(tokenPath(), "old-token\n", { mode: 0o644 });
		fs.chmodSync(tokenPath(), 0o644);
		await declareOnce();
		expect(fs.statSync(tokenPath()).mode & 0o777).toBe(0o600);
	});

	it("names an environment variable instead, when the operator points at one", async () => {
		const { result } = await declareOnce({ tokenEnv: "TG_BOT_TOKEN" }, [
			"telegram",
			"123456789",
			"answer",
			"true",
			"authorize",
		]);
		if (result.status !== "declared") throw new Error("expected declared");
		expect(result.tokenEnv).toBe("TG_BOT_TOKEN");
		expect(result.tokenFile).toBeNull();
		expect(readIfPresent(tokenPath())).toBeNull();
		expect(fs.readFileSync(configPath(), "utf-8")).toContain('"tokenEnv": "TG_BOT_TOKEN"');
	});

	it("declares the token path relative to the sovereign root, never this machine's home", async () => {
		expect(deliveryTokenRelativePath("telegram", testEnv())).toBe(
			path.join(".refarm", "delivery", "telegram.token"),
		);
		// A name that could escape the directory is flattened, not honoured.
		expect(deliveryTokenRelativePath("../../etc/passwd", testEnv())).toBe(
			path.join(".refarm", "delivery", ".._.._etc_passwd.token"),
		);
	});

	it("RESPECTS the parser's refusal of an inline secret instead of routing around it", () => {
		expect(() =>
			buildDeliveryEntry({
				adapter: "telegram",
				name: "telegram",
				capability: "answer",
				unattended: true,
				options: { chatId: "1", token: SECRET },
			}),
		).toThrow(/must not appear in the declaration/);
	});
});

// ── Nothing half-written ──────────────────────────────────────────────────────

describe("refarm delivery add — refusing, deferring, cancelling", () => {
	it("declining changes NOTHING, and is remembered so it is not asked again", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce({}, fullRun({ decision: "decline" }));
		expect(result.status).toBe("declined");
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);
		expect(readIfPresent(tokenPath())).toBeNull();

		const records = await createFileOperationTrail(trailPath()).read();
		expect(records).toHaveLength(1);
		expect(records[0]?.decision).toBe("declined");
	});

	it("deferring writes nothing AND records nothing — the question comes back", async () => {
		writeConfig(EXISTING_CONFIG);
		const { result } = await declareOnce({}, fullRun({ decision: "later" }));
		expect(result.status).toBe("deferred");
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);
		expect(readIfPresent(tokenPath())).toBeNull();
		expect(readIfPresent(trailPath())).toBeNull();
	});

	// `after` is how many prompts are answered before the next one is cancelled, so the last row
	// cancels the AUTHORISATION prompt itself — the point where a half-written run is most likely.
	it.each([
		["at the name", 0],
		["at the chat id", 1],
		["at the capability question", 2],
		["at the unattended question", 3],
		["at the token", 4],
		["at the authorisation itself", 5],
	])("cancelling %s leaves nothing half-written", async (_where, after) => {
		writeConfig(EXISTING_CONFIG);
		const { channel } = cancellingChannel(after);
		const result = await runDeliveryAdd({}, deps(channel));
		expect(result.status).toBe("cancelled");
		// The three things a half-written run would leave behind.
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);
		expect(readIfPresent(tokenPath())).toBeNull();
		expect(readIfPresent(trailPath())).toBeNull();
	});

	it("rolls the declaration back when the token cannot be written", async () => {
		writeConfig(EXISTING_CONFIG);
		const { channel } = recordingChannel(fullRun());
		await expect(
			runDeliveryAdd(
				{},
				deps(channel, {
					tokenWriter: {
						async write() {
							throw new Error("disk is full");
						},
					},
				}),
			),
		).rejects.toThrow(/rolled back/);
		// A declaration pointing at a token that was never written looks configured and is not.
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(EXISTING_CONFIG);
		const records = await createFileOperationTrail(trailPath()).read();
		expect(records.map((record) => record.decision)).toEqual(["authorized", "undone"]);
	});
});

// ── Re-running ────────────────────────────────────────────────────────────────

describe("refarm delivery add — re-running", () => {
	it("does not silently duplicate or clobber: it asks, and keeping is a successful outcome", async () => {
		await declareOnce();
		const beforeSecondRun = fs.readFileSync(configPath(), "utf-8");

		// Second run, operator says "no, keep what is there".
		const { channel, asked } = recordingChannel(["telegram", false]);
		const result = await runDeliveryAdd({}, deps(channel));
		expect(result).toEqual({
			status: "unchanged",
			channel: "telegram",
			reason: "already-declared",
		});
		expect(fs.readFileSync(configPath(), "utf-8")).toBe(beforeSecondRun);
		// It ASKED rather than assumed, and the question names the channel.
		expect(asked[1]?.question).toContain("telegram");
		expect(asked[1]?.type).toBe("confirm");
	});

	it("replaces in place when the operator says so — one entry, chained in the trail", async () => {
		const first = await declareOnce();
		if (first.result.status !== "declared") throw new Error("expected declared");

		const { channel } = recordingChannel([
			"telegram",
			true, // yes, replace
			"999",
			"announce",
			"false",
			SECRET,
			"authorize",
		]);
		const result = await runDeliveryAdd(
			{},
			deps(channel, { now: () => "2026-08-01T00:00:00.000Z" }),
		);
		if (result.status !== "declared") throw new Error(`expected declared, got ${result.status}`);
		expect(result.replaced).toBe(true);

		const written = JSON.parse(fs.readFileSync(configPath(), "utf-8")) as {
			delivery: Record<string, Record<string, unknown>>;
		};
		// KEYED, so there is exactly one — a re-run cannot produce a duplicate.
		expect(Object.keys(written.delivery)).toEqual(["telegram"]);
		expect(written.delivery.telegram?.chatId).toBe("999");
		expect(written.delivery.telegram?.capability).toBe("announce");

		// The change of mind is a CHAIN, not an orphan: the trail stays append-only.
		const records = await createFileOperationTrail(trailPath()).read();
		expect(records).toHaveLength(2);
		expect(records[1]?.revisitOf).toBe(records[0]?.id);
	});

	it("does not re-ask a standing decision by accident, even after the entry was hand-removed", async () => {
		await declareOnce({}, fullRun({ decision: "decline" }));
		// Nothing is in the config — only the refusal is remembered.
		const { channel, asked } = recordingChannel(["telegram", false]);
		const result = await runDeliveryAdd({}, deps(channel));
		expect(result).toEqual({
			status: "unchanged",
			channel: "telegram",
			reason: "already-decided",
		});
		expect(asked[1]?.question).toContain("declined");
	});

	it("--replace skips the gate and re-opens the question directly", async () => {
		await declareOnce();
		const { channel, asked } = recordingChannel([
			"telegram",
			"555",
			"answer",
			"true",
			SECRET,
			"authorize",
		]);
		const result = await runDeliveryAdd({ replace: true }, deps(channel));
		expect(result.status).toBe("declared");
		expect(asked.some((prompt) => prompt.type === "confirm")).toBe(false);
	});
});

// ── No TTY ────────────────────────────────────────────────────────────────────

describe("refarm delivery add — with nobody to ask", () => {
	it("refuses instead of prompting, and instead of hanging", async () => {
		const { channel, asked } = recordingChannel([]);
		await expect(runDeliveryAdd({}, deps(channel, { interactive: false }))).rejects.toBeInstanceOf(
			DeliveryAddRefusal,
		);
		expect(asked).toHaveLength(0);
		expect(readIfPresent(configPath())).toBeNull();
	});

	it("names hand-editing as the path that still works", async () => {
		const { channel } = recordingChannel([]);
		let refusal: DeliveryAddRefusal | null = null;
		try {
			await runDeliveryAdd({}, deps(channel, { interactive: false }));
		} catch (caught) {
			refusal = caught as DeliveryAddRefusal;
		}
		expect(refusal?.code).toBe("delivery-add-not-interactive");
		expect(refusal?.message).toContain("by hand");
		expect(refusal?.message).toContain(configPath());
	});
});

// ── The two questions refarm refuses to guess ─────────────────────────────────

describe("the questions are asked in terms a person can answer", () => {
	it("asks about capability as 'can it bring a decision back', with the consequence of each answer", () => {
		const prompt = deliveryCapabilityPrompt({ channel: "telegram", adapterCanAnswer: true });
		expect(prompt.question).toContain("DECISÃO");
		expect(prompt.question).not.toContain("capability");
		expect(prompt.options.map((option) => option.value)).toEqual(["answer", "announce"]);
		for (const option of prompt.options)
			expect(option.description?.length ?? 0).toBeGreaterThan(20);
	});

	it("asks about unattended as 'does it reach you when you are not attending'", () => {
		const prompt = deliveryUnattendedPrompt({ channel: "telegram", adapterIsUnattended: true });
		expect(prompt.question).toContain("NÃO está atendendo");
		expect(prompt.question).not.toContain("unattended");
		expect(prompt.options[1]?.description).toContain("espera");
	});

	it("never offers a claim the adapter cannot enforce (S3)", () => {
		expect(
			deliveryCapabilityPrompt({ channel: "x", adapterCanAnswer: false }).options,
		).toHaveLength(1);
		expect(
			deliveryUnattendedPrompt({ channel: "x", adapterIsUnattended: false }).options,
		).toHaveLength(1);
	});
});

// ── The CLI surface ───────────────────────────────────────────────────────────

describe("refarm delivery add — the command", () => {
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

	it("refuses with the repo's envelope when there is no terminal, never a stack trace", async () => {
		await createDeliveryCommand().parseAsync(["add", "--json"], { from: "user" });
		const envelope = JSON.parse(stdout.join("\n")) as Record<string, unknown>;
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("delivery-add-not-interactive");
		expect(Array.isArray(envelope.nextCommands)).toBe(true);
		expect(process.exitCode).toBe(1);
		expect(stdout.join("\n")).not.toContain("    at ");
	});

	it("refuses a test send for a channel that is not declared, and sends nothing", async () => {
		vi.stubGlobal("fetch", () => {
			throw new Error("refarm delivery test must not reach the network here");
		});
		await createDeliveryCommand().parseAsync(["test", "nowhere", "--json"], { from: "user" });
		const envelope = JSON.parse(stdout.join("\n")) as Record<string, unknown>;
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("delivery-test-unknown-channel");
		expect(process.exitCode).toBe(1);
		vi.unstubAllGlobals();
	});
});
