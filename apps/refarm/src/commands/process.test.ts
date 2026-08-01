import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	createMemoryOperationTrail,
	type OperationConsentChannel,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import { SupervisionRefusal } from "@refarm.dev/process-contract-v1";
import type { CommandResult, CommandRunner } from "@refarm.dev/process-systemd-user";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	createProcessCommand,
	runProcessInstall,
	runProcessLinger,
	runProcessList,
	runProcessStatus,
	runProcessUninstall,
	type ProcessDeps,
} from "./process.js";

/**
 * Everything here generates units under a THROWAWAY XDG_CONFIG_HOME in the OS temp dir, deleted
 * afterwards, and every `systemctl`/`loginctl` is a scripted fake. Nothing is written to
 * `~/.config/systemd`, and `systemctl --user enable/start` is never run against a real session.
 */

const USER = "op";

const CONFIG = {
	processes: {
		"web-serve": {
			description: "the mesh distribution server the phone bootstraps from",
			command: ["/usr/local/bin/refarm", "web", "serve", ".refarm/dist/farm-client"],
			workingDirectory: "/home/op/github/refarm",
			restart: "always",
		},
		// The second passenger the design names: a certificate renewal is a supervised process too.
		"cert-renew": {
			description: "renew this node's TLS certificate before it expires",
			command: ["/usr/local/bin/refarm", "cert", "issue"],
			restart: "on-failure",
			stopTimeoutSeconds: 60,
		},
	},
};

function ok(stdout: string): CommandResult {
	return { spawned: true, code: 0, stdout, stderr: "" };
}

function scripted(script: Record<string, CommandResult>): CommandRunner & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async run(command, args) {
			const key = [command, ...args].join(" ");
			calls.push(key);
			return script[key] ?? { spawned: true, code: 1, stdout: "", stderr: `unscripted: ${key}` };
		},
	};
}

const READY = { "systemctl --user show-environment": ok("LANG=C\n") };
const LINGER_OFF = { "loginctl show-user op --property=Linger": ok("Linger=no\n") };

function showUnit(name: string, properties: string): Record<string, CommandResult> {
	return {
		[`systemctl --user show refarm-${name}.service --property=LoadState --property=ActiveState --property=SubState`]:
			ok(properties),
	};
}

function answering(answer: string): OperationConsentChannel {
	return {
		async ask() {
			return answer;
		},
	};
}

let configHome: string;
let root: string;

beforeEach(async () => {
	const base = await mkdtemp(path.join(tmpdir(), "refarm-process-cli-"));
	configHome = path.join(base, "config");
	root = path.join(base, "root");
});

afterEach(async () => {
	await rm(path.dirname(configHome), { recursive: true, force: true });
});

function deps(runner: CommandRunner, extra: Partial<ProcessDeps> = {}): ProcessDeps {
	return {
		root,
		runner,
		user: USER,
		env: { XDG_CONFIG_HOME: configHome, SOVEREIGN_DIR: ".refarm" },
		config: CONFIG,
		now: () => "2026-07-31T12:00:00.000Z",
		...extra,
	};
}

describe("refarm process list — the catalog, the supervisor, and the honest lifetime", () => {
	it("lists what is declared, with the restart policy and stop timeout the operator wrote", async () => {
		const result = await runProcessList(deps(scripted({ ...READY, ...LINGER_OFF })));
		expect(result.backend).toBe("systemd-user");
		expect(result.processes.map((entry) => entry.name)).toEqual(["web-serve", "cert-renew"]);
		expect(result.processes[0]?.restart).toBe("always");
		expect(result.processes[1]?.stopTimeoutSeconds).toBe(60);
	});

	it("states the lifetime it delivers, including the logout", async () => {
		const result = await runProcessList(deps(scripted({ ...READY, ...LINGER_OFF })));
		expect(result.lifetime).toMatch(/STOPS WHEN YOU LOG OUT/);
	});

	it("an UNDECLARED catalog lists nothing and is not an error — silence is consent", async () => {
		const result = await runProcessList(
			deps(scripted({ ...READY, ...LINGER_OFF }), { config: {} }),
		);
		expect(result.ok).toBe(true);
		expect(result.processes).toEqual([]);
	});

	it("a host with no supervisor says so, with the fix, instead of crashing", async () => {
		const result = await runProcessList(deps(scripted({})));
		expect(result.backend).toBeNull();
		expect(result.backendDetail).toMatch(/no supervisor on this host can be borrowed/);
		expect(result.backendDetail).toMatch(/start by hand/);
	});
});

describe("refarm process status — three answers, kept apart", () => {
	it("reports a declared, installed, running process as up", async () => {
		const result = await runProcessStatus(
			["web-serve"],
			deps(
				scripted({
					...READY,
					...showUnit("web-serve", "LoadState=loaded\nActiveState=active\nSubState=running\n"),
				}),
			),
		);
		expect(result.ok).toBe(true);
		expect(result.statuses[0]?.state).toBe("running");
	});

	it("NOT RUNNING is a verdict from the supervisor", async () => {
		const result = await runProcessStatus(
			["web-serve"],
			deps(
				scripted({
					...READY,
					...showUnit("web-serve", "LoadState=loaded\nActiveState=failed\nSubState=failed\n"),
				}),
			),
		);
		expect(result.ok).toBe(false);
		expect(result.statuses[0]?.state).toBe("not-running");
		expect(result.lines[0]).toMatch(/DOWN/);
	});

	it("NOT DECLARED is its own answer, and not a failure of the declared ones", async () => {
		const result = await runProcessStatus(["nothing-like-this"], deps(scripted({ ...READY })));
		expect(result.statuses[0]?.state).toBe("not-declared");
		expect(result.statuses[0]?.backend).toBeNull();
		expect(result.ok).toBe(true);
		expect(result.lines[0]).toMatch(/not declared/);
		expect(result.lines[0]).toContain(`Checked ${path.join(root, ".refarm", "config.json")}`);
	});

	it("COULD NOT ASK when there is no supervisor at all — never a silent 'down'", async () => {
		const result = await runProcessStatus(["web-serve"], deps(scripted({})));
		expect(result.statuses[0]?.state).toBe("could-not-ask");
		expect(result.statuses[0]?.supervised).toBeNull();
		expect(result.lines[0]).toMatch(/unknown, could not ask/);
		expect(result.ok).toBe(false);
	});

	it("with no names, it answers for the whole declared catalog", async () => {
		const result = await runProcessStatus(
			[],
			deps(
				scripted({
					...READY,
					...showUnit("web-serve", "LoadState=loaded\nActiveState=active\nSubState=running\n"),
					...showUnit("cert-renew", "LoadState=not-found\nActiveState=inactive\nSubState=dead\n"),
				}),
			),
		);
		expect(result.statuses.map((status) => status.state)).toEqual(["running", "not-running"]);
		expect(result.statuses[1]?.supervised).toBe(false);
	});
});

describe("refarm process install — the unit is shown, decided, written, and undoable", () => {
	function installDeps(trail: OperationTrail, answer: string, lines: string[]): ProcessDeps {
		return deps(scripted({ ...READY, ...LINGER_OFF }), {
			trail,
			operator: answering(answer),
			say: (line) => lines.push(line),
		});
	}

	it("shows the exact unit BEFORE the decision, and says what lifetime it delivers", async () => {
		const lines: string[] = [];
		const result = await runProcessInstall(
			"web-serve",
			{},
			installDeps(createMemoryOperationTrail(), "later", lines),
		);
		const shown = lines.join("\n");
		expect(shown).toContain("ExecStart=/usr/local/bin/refarm web serve .refarm/dist/farm-client");
		expect(shown).toContain("Restart=always");
		expect(shown).toContain("TimeoutStopSec=20");
		expect(shown).toMatch(/STOPS WHEN YOU LOG OUT/);
		expect(result.status).toBe("deferred");
		await expect(stat(result.unitPath)).rejects.toThrow();
	});

	it("authorising writes the unit, and hands the ACTIVATION to the operator", async () => {
		const result = await runProcessInstall(
			"web-serve",
			{},
			installDeps(createMemoryOperationTrail(), "authorize", []),
		);
		expect(result.status).toBe("authorized");
		expect(await readFile(result.unitPath, "utf8")).toBe(result.unitText);
		expect(result.activationCommands).toEqual([
			"systemctl --user daemon-reload",
			"systemctl --user enable --now refarm-web-serve.service",
		]);
	});

	it("never runs systemctl enable or start itself", async () => {
		const runner = scripted({ ...READY, ...LINGER_OFF });
		await runProcessInstall(
			"web-serve",
			{},
			deps(runner, {
				trail: createMemoryOperationTrail(),
				operator: answering("authorize"),
			}),
		);
		expect(runner.calls.some((call) => /enable|start|--now/.test(call))).toBe(false);
	});

	it("declining writes nothing", async () => {
		const result = await runProcessInstall(
			"web-serve",
			{},
			installDeps(createMemoryOperationTrail(), "decline", []),
		);
		expect(result.ok).toBe(false);
		await expect(stat(result.unitPath)).rejects.toThrow();
	});

	it("refuses an undeclared process by name, naming the fix", async () => {
		const error = await runProcessInstall(
			"not-a-thing",
			{},
			deps(scripted({ ...READY, ...LINGER_OFF })),
		).then(
			() => null,
			(thrown: unknown) => thrown as SupervisionRefusal,
		);
		expect(error).toBeInstanceOf(SupervisionRefusal);
		expect(error?.reason).toBe("not-declared");
		expect(error?.message).toMatch(/not declared in \.refarm\/config\.json/);
	});

	it("uninstall APPLIES the recorded undo and the unit is gone from the disk", async () => {
		const trail = createMemoryOperationTrail();
		const installed = await runProcessInstall("web-serve", {}, installDeps(trail, "authorize", []));
		await stat(installed.unitPath);

		const undone = await runProcessUninstall(
			"web-serve",
			deps(scripted({ ...READY, ...LINGER_OFF }), { trail }),
		);
		await expect(stat(installed.unitPath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(undone.removedPath).toBe(installed.unitPath);
		expect((await trail.read()).map((record) => record.decision)).toEqual(["authorized", "undone"]);
	});

	it("uninstall refuses when nothing authorised was ever recorded", async () => {
		const error = await runProcessUninstall(
			"web-serve",
			deps(scripted({ ...READY, ...LINGER_OFF }), { trail: createMemoryOperationTrail() }),
		).then(
			() => null,
			(thrown: unknown) => thrown as SupervisionRefusal,
		);
		expect(error).toBeInstanceOf(SupervisionRefusal);
		expect(error?.reason).toBe("nothing-to-undo");
	});
});

describe("lingering is a separate operation, and cannot be reached through install", () => {
	it("installing a unit never touches the lingering state", async () => {
		const runner = scripted({ ...READY, ...LINGER_OFF });
		const result = await runProcessInstall(
			"web-serve",
			{},
			deps(runner, {
				trail: createMemoryOperationTrail(),
				operator: answering("authorize"),
			}),
		);
		expect(runner.calls.some((call) => call.includes("enable-linger"))).toBe(false);
		expect(await readFile(result.unitPath, "utf8")).not.toContain("linger");
	});

	it("`process linger` is its own subcommand, with its own decision", async () => {
		const names = createProcessCommand().commands.map((child) => child.name());
		expect(names).toContain("linger");
		expect(names).toContain("install");
	});

	it("authorising the linger operation runs loginctl enable-linger — and only then", async () => {
		const runner = scripted({
			...LINGER_OFF,
			"loginctl enable-linger op": ok(""),
		});
		const declined = await runProcessLinger(
			{},
			deps(runner, { trail: createMemoryOperationTrail(), operator: answering("decline") }),
		);
		expect(declined.status).toBe("declined");
		expect(runner.calls).not.toContain("loginctl enable-linger op");

		const authorized = await runProcessLinger(
			{},
			deps(runner, { trail: createMemoryOperationTrail(), operator: answering("authorize") }),
		);
		expect(authorized.status).toBe("authorized");
		expect(runner.calls).toContain("loginctl enable-linger op");
	});

	it("does not ask at all when lingering is already on", async () => {
		const result = await runProcessLinger(
			{},
			deps(scripted({ "loginctl show-user op --property=Linger": ok("Linger=yes\n") }), {
				trail: createMemoryOperationTrail(),
				operator: answering("authorize"),
			}),
		);
		expect(result.status).toBe("already-enabled");
		expect(result.recordId).toBeNull();
	});

	it("states the cost, not only the benefit", async () => {
		const lines: string[] = [];
		await runProcessLinger(
			{},
			deps(scripted(LINGER_OFF), {
				trail: createMemoryOperationTrail(),
				operator: answering("later"),
				say: (line) => lines.push(line),
			}),
		);
		const shown = lines.join("\n");
		expect(shown).toMatch(/O QUE CUSTA/);
		expect(shown).toMatch(/loginctl disable-linger op/);
	});
});
