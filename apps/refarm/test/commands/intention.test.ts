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
});
