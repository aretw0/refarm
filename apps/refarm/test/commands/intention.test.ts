import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createIntentionCommand } from "../../src/commands/intention.js";

describe("intentionCommand", () => {
	let home: string;
	let cwd: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-intention-home-"));
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-intention-cwd-"));
		originalHome = process.env.REFARM_HOME;
		process.env.REFARM_HOME = home;
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		process.exitCode = undefined;
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.REFARM_HOME;
		} else {
			process.env.REFARM_HOME = originalHome;
		}
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it("arms explicit scope and emits next check command", async () => {
		const command = createIntentionCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["arm", "--scope", "connection-up:ovpn-serpro", "--window-ms", "60000", "--json"],
			{ from: "user" },
		);

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			ok: true,
			command: "intention",
			operation: "arm",
			scope: "connection-up:ovpn-serpro",
			windowMs: 60000,
			nextCommand:
				"refarm intention check --scope 'connection-up:ovpn-serpro' --window-ms 60000 --json",
		});
	});

	it("checks readiness and returns exit 2 when not armed", async () => {
		const command = createIntentionCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["check", "--scope", "connection-up:ovpn-serpro", "--window-ms", "60000", "--json"],
			{ from: "user" },
		);

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			ok: false,
			operation: "check",
			scope: "connection-up:ovpn-serpro",
			nextCommand:
				"refarm intention arm --scope 'connection-up:ovpn-serpro' --window-ms 60000 --json",
		});
		expect(process.exitCode).toBe(2);
	});

	it("supports profile-driven cross-device intent", async () => {
		const command = createIntentionCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["arm", "--profile", "cross-device-handoff", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			ok: true,
			scope: "attention:cross-device-handoff",
			windowMs: 120000,
		});
		expect(typeof payload.intentToken).toBe("string");
		expect((payload.intentToken as string).startsWith("rfint.v1.")).toBe(true);
	});

	it("prepares portable intent without local state coupling", async () => {
		const now = Date.now();
		const command = createIntentionCommand({ now: () => now });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["prepare", "--profile", "cross-device-handoff", "--json"],
			{ from: "user" },
		);

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			ok: true,
			operation: "prepare",
			source: "portable",
			scope: "attention:cross-device-handoff",
			windowMs: 120000,
		});
		expect(typeof payload.intentToken).toBe("string");
		expect(payload.nextCommands).toHaveLength(2);
		expect((payload.nextCommands[0] as string).startsWith("refarm intention check --token")).toBe(
			true,
		);
		expect((payload.nextCommands[1] as string).startsWith("refarm intention consume --token")).toBe(
			true,
		);
	});

	it("supports compact JSON output for portable prepare", async () => {
		const command = createIntentionCommand({ now: () => 1_700_000_000_000 });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			[
				"prepare",
				"--scope",
				"attention:operator-sync",
				"--window-ms",
				"60000",
				"--json",
				"--output",
				"compact",
			],
			{ from: "user" },
		);

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			v: 1,
			ok: true,
			op: "prepare",
			scope: "attention:operator-sync",
			source: "portable",
			windowMs: 60000,
		});
		expect(typeof payload.intentToken).toBe("string");
		expect(Array.isArray(payload.nextCommands)).toBe(true);
		expect(payload.nextAction).toBeUndefined();
		expect(payload.command).toBeUndefined();
	});

	it("checks readiness via portable token from another device", async () => {
		const now = Date.now();
		const command = createIntentionCommand({ now: () => now });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["arm", "--scope", "attention:mobile-ready", "--window-ms", "90000", "--json"],
			{ from: "user" },
		);
		const armPayload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		const token = armPayload.intentToken as string;

		logSpy.mockClear();
		await command.parseAsync(["check", "--token", token, "--json"], {
			from: "user",
		});

		const checkPayload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(checkPayload).toMatchObject({
			ok: true,
			operation: "check",
			source: "token",
			scope: "attention:mobile-ready",
			windowMs: 90000,
		});
		expect(process.exitCode).toBe(0);
	});

	it("fails check when portable token is expired", async () => {
		const armedAt = Date.now();
		const armCommand = createIntentionCommand({ now: () => armedAt });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await armCommand.parseAsync(
			["arm", "--scope", "attention:mobile-ready", "--window-ms", "1000", "--json"],
			{ from: "user" },
		);
		const token = JSON.parse(logSpy.mock.calls[0]?.[0] as string).intentToken as string;

		logSpy.mockClear();
		process.exitCode = undefined;
		const checkCommand = createIntentionCommand({ now: () => armedAt + 1500 });
		await checkCommand.parseAsync(["check", "--token", token, "--json"], {
			from: "user",
		});

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			ok: false,
			operation: "check",
			source: "token",
			scope: "attention:mobile-ready",
		});
		expect(process.exitCode).toBe(2);
	});

	it("consumes intent and asks for re-arm", async () => {
		const command = createIntentionCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["arm", "--scope", "attention:mobile-ready", "--json"], {
			from: "user",
		});
		logSpy.mockClear();

		await command.parseAsync(["consume", "--scope", "attention:mobile-ready", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			ok: true,
			operation: "consume",
			scope: "attention:mobile-ready",
			nextCommand:
				"refarm intention arm --scope 'attention:mobile-ready' --window-ms 300000 --json",
		});
	});

	it("consumes portable token without local state", async () => {
		const command = createIntentionCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["arm", "--scope", "attention:cross-device-handoff", "--window-ms", "120000", "--json"],
			{ from: "user" },
		);
		const token = JSON.parse(logSpy.mock.calls[0]?.[0] as string).intentToken as string;

		logSpy.mockClear();
		await command.parseAsync(["consume", "--token", token, "--json"], {
			from: "user",
		});

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			ok: true,
			operation: "consume",
			source: "token",
			scope: "attention:cross-device-handoff",
			nextCommand:
				"refarm intention arm --scope 'attention:cross-device-handoff' --window-ms 120000 --json",
		});
	});

	it("allows token handoff between separate device contexts", async () => {
		const now = Date.now();
		const senderCommand = createIntentionCommand({ now: () => now });
		const senderLog = vi.spyOn(console, "log").mockImplementation(() => {});

		await senderCommand.parseAsync(
			["prepare", "--scope", "attention:operator-sync", "--window-ms", "60000", "--json"],
			{ from: "user" },
		);
		const token = JSON.parse(senderLog.mock.calls[0]?.[0] as string).intentToken as string;

		senderLog.mockClear();
		const receiverHome = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-intention-other-home-"));
		process.env.REFARM_HOME = receiverHome;
		const receiverCommand = createIntentionCommand({ now: () => now + 1000 });
		await receiverCommand.parseAsync(["check", "--token", token, "--json"], { from: "user" });

		const checkPayload = JSON.parse(senderLog.mock.calls[0]?.[0] as string);
		expect(checkPayload).toMatchObject({
			ok: true,
			operation: "check",
			source: "token",
			scope: "attention:operator-sync",
		});
	});

	it("supports compact JSON output for token check", async () => {
		const now = Date.now();
		const command = createIntentionCommand({ now: () => now });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["arm", "--scope", "attention:mobile-ready", "--window-ms", "90000", "--json"],
			{ from: "user" },
		);
		const token = JSON.parse(logSpy.mock.calls[0]?.[0] as string).intentToken as string;

		logSpy.mockClear();
		await command.parseAsync(["check", "--token", token, "--json", "--output", "compact"], {
			from: "user",
		});

		const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			v: 1,
			ok: true,
			op: "check",
			scope: "attention:mobile-ready",
			source: "token",
			armed: true,
			windowMs: 90000,
		});
		expect(payload.command).toBeUndefined();
	});
});

/**
 * The refusal path. Running `refarm intention check --json` with no `--scope`
 * printed a raw Node stack trace and ignored `--json` entirely — a JSON consumer
 * got a crash on stderr and no envelope. None of the suite's 1967 tests exercised
 * a missing-argument path, so nothing caught it.
 *
 * These pin the boundary for every subcommand: a validation error becomes the
 * repo's refusal shape (envelope under --json, one calm line otherwise, non-zero
 * exit) and NEVER an uncaught exception.
 */
describe("intentionCommand — invalid input refuses, never throws", () => {
	let home: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-intention-refuse-"));
		originalHome = process.env.REFARM_HOME;
		process.env.REFARM_HOME = home;
		process.exitCode = undefined;
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.REFARM_HOME;
		else process.env.REFARM_HOME = originalHome;
		vi.restoreAllMocks();
		process.exitCode = undefined;
		fs.rmSync(home, { recursive: true, force: true });
	});

	const cases: Array<{ name: string; argv: string[]; operation: string }> = [
		{ name: "prepare with neither scope nor profile", argv: ["prepare"], operation: "prepare" },
		{ name: "arm with neither scope nor profile", argv: ["arm"], operation: "arm" },
		{ name: "check with neither scope nor profile", argv: ["check"], operation: "check" },
		{ name: "consume with neither scope nor profile", argv: ["consume"], operation: "consume" },
		{
			name: "check with a malformed portable token",
			argv: ["check", "--token", "not-a-real-token"],
			operation: "check",
		},
		{
			name: "consume with a malformed portable token",
			argv: ["consume", "--token", "not-a-real-token"],
			operation: "consume",
		},
	];

	for (const { name, argv, operation } of cases) {
		it(`${name} — emits an error envelope under --json`, async () => {
			const command = createIntentionCommand();
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			// The assertion that matters: this resolves. Before the boundary existed it rejected.
			await command.parseAsync([...argv, "--json"], { from: "user" });

			const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
				ok: boolean;
				command: string;
				operation: string;
				error: string;
				message: string;
				nextCommand: string;
			};
			expect(payload.ok).toBe(false);
			expect(payload.command).toBe("intention");
			expect(payload.operation).toBe(operation);
			expect(payload.error).toBe("intention-invalid-request");
			expect(payload.message.length).toBeGreaterThan(0);
			expect(payload.nextCommand).toBe("refarm intention --help");
			expect(process.exitCode).toBe(1);
		});

		it(`${name} — one calm line and no stack trace without --json`, async () => {
			const command = createIntentionCommand();
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await command.parseAsync(argv, { from: "user" });

			const written = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
			expect(written).not.toContain("    at ");
			expect(written).toContain("refarm intention --help");
			expect(process.exitCode).toBe(1);
		});
	}

	it("a refused command writes no attention state", async () => {
		const command = createIntentionCommand();
		vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["arm"], { from: "user" });

		// A refusal must leave the machine exactly as it found it — arming is the one
		// subcommand that persists, so a half-applied arm is the failure to exclude.
		expect(fs.existsSync(path.join(home, ".refarm"))).toBe(false);
	});
});
