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
});
