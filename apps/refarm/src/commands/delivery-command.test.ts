import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeliveryCommand } from "./delivery-command.js";

/**
 * `refarm delivery` — the inspection surface, held to two promises:
 *
 *  1. **it sends nothing**. Every assertion below runs with `fetch` replaced by
 *     a throwing stub, so a subcommand that reached the network would fail here
 *     rather than on the operator's phone.
 *  2. **it prints no secret**. The token value is put in the environment the
 *     command reads, and the output is checked for it directly — naming a source
 *     is the contract, and this is what stops that eroding into a convenience.
 */

let workdir: string;
let originalCwd: string;
let stdout: string[];
let stderr: string[];

const SECRET = "1234567:AA-this-must-never-be-printed";

beforeEach(() => {
	originalCwd = process.cwd();
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-delivery-cmd-"));
	process.chdir(workdir);
	stdout = [];
	stderr = [];
	vi.spyOn(console, "log").mockImplementation((...args) => void stdout.push(args.join(" ")));
	vi.spyOn(console, "error").mockImplementation((...args) => void stderr.push(args.join(" ")));
	vi.stubGlobal("fetch", () => {
		throw new Error("refarm delivery must not reach the network");
	});
	vi.stubEnv("REFARM_TELEGRAM_BOT_TOKEN", SECRET);
	// D8 reads the attention window from REFARM_HOME; keep it inside the sandbox.
	vi.stubEnv("REFARM_HOME", path.join(workdir, ".refarm"));
	delete process.env.REFARM_OPERATOR_ATTENTION_SCOPE;
});

afterEach(() => {
	process.chdir(originalCwd);
	fs.rmSync(workdir, { recursive: true, force: true });
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

function writeConfig(config: unknown): void {
	fs.mkdirSync(path.join(workdir, ".refarm"), { recursive: true });
	fs.writeFileSync(path.join(workdir, ".refarm", "config.json"), JSON.stringify(config));
}

function declareTelegram(overrides: Record<string, unknown> = {}): void {
	writeConfig({
		delivery: {
			telegram: {
				capability: "answer",
				unattended: true,
				chatId: "123456789",
				tokenEnv: "REFARM_TELEGRAM_BOT_TOKEN",
				...overrides,
			},
		},
	});
}

async function run(argv: string[]): Promise<{ json: Record<string, unknown> | null; text: string }> {
	stdout = [];
	stderr = [];
	await createDeliveryCommand().parseAsync(argv, { from: "user" });
	const text = [...stdout, ...stderr].join("\n");
	const first = stdout.join("\n").trim();
	let json: Record<string, unknown> | null = null;
	try {
		json = first ? (JSON.parse(first) as Record<string, unknown>) : null;
	} catch {
		json = null;
	}
	return { json, text };
}

describe("refarm delivery list", () => {
	it("says plainly that nothing is declared", async () => {
		const { json } = await run(["list", "--json"]);
		expect(json?.ok).toBe(true);
		expect(json?.declared).toBe(false);
		expect(json?.channels).toEqual([]);
		expect(json?.nextAction).toBe(
			"Declare a delivery channel through the guided authoring journey.",
		);
		expect(json?.nextCommand).toBe("refarm delivery add");
	});

	it("names the token SOURCE and never its value", async () => {
		declareTelegram();
		const { json, text } = await run(["list", "--json"]);
		expect(json?.declared).toBe(true);
		expect(json?.channels).toEqual([
			{
				channel: "telegram",
				adapter: "telegram",
				capability: "answer",
				unattended: true,
				token: "env:REFARM_TELEGRAM_BOT_TOKEN",
			},
		]);
		expect(text).not.toContain(SECRET);
		expect(JSON.stringify(json)).not.toContain(SECRET);
	});

	it("reports a channel that cannot be brought up instead of hiding it", async () => {
		writeConfig({ delivery: { pigeon: { capability: "announce", unattended: false } } });
		const { json } = await run(["list", "--json"]);
		expect(json?.channels).toEqual([]);
		expect(JSON.stringify(json?.issues)).toContain("pigeon");
	});
});

describe("refarm delivery route", () => {
	it("shows a confirm reaching the declared channel, and sends nothing", async () => {
		declareTelegram();
		const { json } = await run(["route", "--kind", "confirm", "--json"]);
		expect(json?.ok).toBe(true);
		expect(json?.answerable).toBe(true);
		expect(json?.sent).toBe(false);
		expect(json?.routes).toEqual([{ channel: "telegram", adapter: "telegram", mode: "answer" }]);
	});

	it("shows a secret refusing to travel (P4), with the reason named", async () => {
		declareTelegram();
		const { json } = await run(["route", "--kind", "secret", "--json"]);
		expect(json?.answerable).toBe(false);
		expect(JSON.stringify(json?.refusals)).toContain("answer-would-travel");
	});

	it("shows an attended-only channel refusing while nobody attends (D8)", async () => {
		declareTelegram({ unattended: false });
		const { json } = await run(["route", "--kind", "confirm", "--json"]);
		expect(JSON.stringify(json?.refusals)).toContain("attended-only");
		const attended = await run(["route", "--kind", "confirm", "--attending", "--json"]);
		expect(attended.json?.answerable).toBe(true);
	});

	it("REFUSES an unknown kind with the repo's envelope, not a stack trace", async () => {
		const { json, text } = await run(["route", "--kind", "telepathy", "--json"]);
		expect(json?.ok).toBe(false);
		expect(json?.error).toBe("delivery-invalid-request");
		expect(json?.nextCommand).toBe("refarm delivery --help");
		expect(process.exitCode).toBe(1);
		expect(text).not.toContain("    at ");
	});

	it("REFUSES without --json too, and still exits non-zero", async () => {
		const { text } = await run(["route", "--kind", "telepathy"]);
		expect(text).toContain("--kind must be one of");
		expect(process.exitCode).toBe(1);
	});
});
