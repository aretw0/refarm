import { describe, expect, it } from "vitest";

import {
	DEFAULT_RESTART_DELAY_SECONDS,
	DEFAULT_STOP_TIMEOUT_SECONDS,
	describeProcessStatus,
	MAX_DECLARED_PROCESSES,
	parseProcessCatalog,
	processCouldNotAsk,
	processIsKnownUp,
	processNotDeclared,
	processNotRunning,
	processRunning,
	ProcessDeclarationError,
	resolveSupervisionBackend,
	SupervisionRefusal,
	type ProcessDeclaration,
	type SupervisionBackend,
} from "./index.js";

const WEB_SERVE = {
	description: "the mesh distribution server the phone bootstraps from",
	command: ["/usr/local/bin/refarm", "web", "serve", ".refarm/dist/farm-client"],
	workingDirectory: "/home/op/github/refarm",
	restart: "always",
} as const;

function catalogWith(processes: Record<string, unknown>) {
	return parseProcessCatalog({ processes });
}

describe("the catalog is declared, and silence is closed", () => {
	it("reads a declared process out of the `processes` key", () => {
		const catalog = catalogWith({ "web-serve": WEB_SERVE });
		const declaration = catalog.get("web-serve");
		expect(declaration?.name).toBe("web-serve");
		expect(declaration?.command).toEqual([
			"/usr/local/bin/refarm",
			"web",
			"serve",
			".refarm/dist/farm-client",
		]);
		expect(declaration?.restart).toBe("always");
		expect(declaration?.workingDirectory).toBe("/home/op/github/refarm");
	});

	it("an ABSENT block is an empty catalog — refarm does not go looking for a process", () => {
		expect(parseProcessCatalog({}).size).toBe(0);
		expect(parseProcessCatalog({ processes: null }).size).toBe(0);
		expect(parseProcessCatalog(undefined).size).toBe(0);
		expect(parseProcessCatalog("not a config").size).toBe(0);
	});

	it("a PRESENT but malformed block throws rather than supervising something else", () => {
		expect(() => parseProcessCatalog({ processes: [] })).toThrow(ProcessDeclarationError);
		expect(() => parseProcessCatalog({ processes: "web-serve" })).toThrow(/expected an object/);
	});

	it("bounds how many processes may be declared", () => {
		const many: Record<string, unknown> = {};
		for (let i = 0; i <= MAX_DECLARED_PROCESSES; i++) many[`p${i}`] = WEB_SERVE;
		expect(() => catalogWith(many)).toThrow(
			new RegExp(`at most ${MAX_DECLARED_PROCESSES} are allowed`),
		);
	});

	it("fills the defaults that are safe to default, and only those", () => {
		const declaration = catalogWith({ "web-serve": WEB_SERVE }).get("web-serve");
		expect(declaration?.stopTimeoutSeconds).toBe(DEFAULT_STOP_TIMEOUT_SECONDS);
		expect(declaration?.restartDelaySeconds).toBe(DEFAULT_RESTART_DELAY_SECONDS);
		expect(declaration?.environment).toEqual({});
		expect(
			catalogWith({ "cert-renew": { ...WEB_SERVE, description: undefined } }).get("cert-renew")
				?.description,
		).toBe("cert-renew");
	});
});

describe("a malformed declaration is refused BY NAME", () => {
	it("names the process when the entry is not an object", () => {
		expect(() => catalogWith({ "web-serve": "refarm web serve" })).toThrow(
			/processes\."web-serve": expected an object, got string/,
		);
	});

	it("refuses a shell line, because splitting one is a quoting bug waiting to happen", () => {
		expect(() =>
			catalogWith({ "web-serve": { ...WEB_SERVE, command: "refarm web serve ." } }),
		).toThrow(/processes\."web-serve": "command" must be an ARRAY/);
	});

	it("refuses an empty command", () => {
		expect(() => catalogWith({ "web-serve": { ...WEB_SERVE, command: [] } })).toThrow(
			/processes\."web-serve": "command" must be a non-empty array/,
		);
	});

	it("refuses an argument that spans lines — a unit file is line-oriented", () => {
		expect(() =>
			catalogWith({ "web-serve": { ...WEB_SERVE, command: ["/bin/x", "a\nExecStart=/bin/evil"] } }),
		).toThrow(/processes\."web-serve": command\[1\] contains a newline/);
	});

	it("REQUIRES a restart policy — whether it comes back is not refarm's to guess", () => {
		const { restart: _dropped, ...withoutRestart } = WEB_SERVE;
		expect(() => catalogWith({ "web-serve": withoutRestart })).toThrow(
			/processes\."web-serve": "restart" must be declared/,
		);
		expect(() => catalogWith({ "web-serve": { ...WEB_SERVE, restart: "sometimes" } })).toThrow(
			/processes\."web-serve": "restart" must be one of/,
		);
	});

	it("refuses a relative workingDirectory", () => {
		expect(() =>
			catalogWith({ "web-serve": { ...WEB_SERVE, workingDirectory: "./here" } }),
		).toThrow(/must be ABSOLUTE/);
	});

	it("refuses a name that would not be safe as a filename", () => {
		expect(() => catalogWith({ "../../etc/passwd": WEB_SERVE })).toThrow(
			/processes\."\.\.\/\.\.\/etc\/passwd": a process name must be lowercase/,
		);
		expect(() => catalogWith({ "Web Serve": WEB_SERVE })).toThrow(/must be lowercase/);
	});

	it("refuses a stop timeout that is not a whole number of seconds in range", () => {
		expect(() => catalogWith({ "web-serve": { ...WEB_SERVE, stopTimeoutSeconds: 1.5 } })).toThrow(
			/"stopTimeoutSeconds" must be a whole number/,
		);
		expect(() =>
			catalogWith({ "web-serve": { ...WEB_SERVE, stopTimeoutSeconds: 100_000 } }),
		).toThrow(/"stopTimeoutSeconds" must be a whole number/);
	});

	it("refuses an inline secret in the environment — a unit file is world-readable", () => {
		expect(() =>
			catalogWith({
				"web-serve": { ...WEB_SERVE, environment: { TELEGRAM_BOT_TOKEN: "12345:abcdef" } },
			}),
		).toThrow(/environment\."TELEGRAM_BOT_TOKEN" looks like a secret/);
		expect(() =>
			catalogWith({ "web-serve": { ...WEB_SERVE, environment: { PASSWORD: "hunter2" } } }),
		).toThrow(/looks like a secret/);
	});

	it("does not mistake an ordinary variable for a secret", () => {
		const declaration = catalogWith({
			"web-serve": { ...WEB_SERVE, environment: { NODE_ENV: "production", TOKENIZER: "x" } },
		}).get("web-serve");
		expect(declaration?.environment).toEqual({ NODE_ENV: "production", TOKENIZER: "x" });
	});
});

describe("the three-way distinction between not-running, not-declared and could-not-ask", () => {
	const up = processRunning("web-serve", "systemd-user", "active (running) since 10:00");
	const down = processNotRunning("web-serve", "systemd-user", "inactive (dead)");
	const undeclared = processNotDeclared("cert-renew");
	const unknown = processCouldNotAsk("web-serve", "systemctl --user is not on PATH");

	it("keeps the three negatives apart as distinct states", () => {
		expect(new Set([down.state, undeclared.state, unknown.state]).size).toBe(3);
		expect(down.state).toBe("not-running");
		expect(undeclared.state).toBe("not-declared");
		expect(unknown.state).toBe("could-not-ask");
	});

	it("only a verdict of RUNNING counts as known-up", () => {
		expect(processIsKnownUp(up)).toBe(true);
		for (const status of [down, undeclared, unknown]) {
			expect(processIsKnownUp(status)).toBe(false);
		}
	});

	it("says which supervisor answered, and null when none did", () => {
		expect(down.backend).toBe("systemd-user");
		expect(undeclared.backend).toBeNull();
		expect(unknown.backend).toBeNull();
	});

	it("distinguishes 'declared but never installed' from 'could not find out'", () => {
		expect(processNotRunning("web-serve", "systemd-user", "no unit", false).supervised).toBe(false);
		expect(unknown.supervised).toBeNull();
	});

	it("renders each case in words an operator can act on", () => {
		expect(describeProcessStatus(up)).toMatch(/web-serve: up \(systemd-user\)/);
		expect(describeProcessStatus(down)).toMatch(/web-serve: DOWN \(systemd-user\)/);
		expect(describeProcessStatus(undeclared)).toMatch(/not declared/);
		expect(describeProcessStatus(unknown)).toMatch(/unknown, could not ask/);
	});
});

describe("resolving a supervision backend decides HOW, never WHAT", () => {
	function backend(id: string, ready: boolean, fix?: string): SupervisionBackend {
		return {
			id,
			title: id,
			async describeLifetime() {
				return "for tests";
			},
			async preflight() {
				return ready
					? { ready, detail: "ok" }
					: { ready, detail: "absent", ...(fix ? { fix } : {}) };
			},
			async status(declaration: ProcessDeclaration) {
				return processCouldNotAsk(declaration.name, "test backend", id);
			},
			async plan() {
				return {};
			},
		};
	}

	it("takes the first backend that is ready, in preference order", async () => {
		const resolved = await resolveSupervisionBackend([
			backend("systemd-user", false),
			backend("launchd", true),
			backend("tractor", true),
		]);
		expect(resolved.id).toBe("launchd");
	});

	it("a host with NO borrowable supervisor is refused honestly, naming the fix", async () => {
		await expect(
			resolveSupervisionBackend([backend("systemd-user", false, "install systemd, or use Termux")]),
		).rejects.toBeInstanceOf(SupervisionRefusal);
		const error = await resolveSupervisionBackend([
			backend("systemd-user", false, "install systemd, or use Termux"),
		]).catch((e: unknown) => e as SupervisionRefusal);
		expect(error.reason).toBe("no-supervisor");
		expect(error.message).toContain("systemd-user: absent");
		expect(error.message).toContain("install systemd, or use Termux");
		expect(error.fix).toMatch(/still a command you can start by hand/);
	});

	it("refuses rather than crashing when no backend is registered at all", async () => {
		const error = await resolveSupervisionBackend([]).catch(
			(e: unknown) => e as SupervisionRefusal,
		);
		expect(error).toBeInstanceOf(SupervisionRefusal);
		expect(error.fix).toMatch(/No supervision backend is registered for this platform/);
	});
});
