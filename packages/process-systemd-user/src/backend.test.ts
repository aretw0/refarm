import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	createMemoryOperationTrail,
	createNodeOperationFileSystem,
	renderOperationRequest,
	runOperationConsent,
	undoOperationRecord,
	type OperationConsentChannel,
	type OperationRecord,
} from "@refarm.dev/operation-consent-v1";
import {
	parseProcessCatalog,
	processIsKnownUp,
	SupervisionRefusal,
	type ProcessDeclaration,
} from "@refarm.dev/process-contract-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSystemdUserBackend, SYSTEMD_USER_BACKEND_ID } from "./backend.js";
import { LINGER_DIR, lingerMarkerPath } from "./linger.js";
import type { CommandResult, CommandRunner } from "./runner.js";
import { renderSystemdUnit, systemdUnitPath } from "./unit.js";

const USER = "op";

const DECLARATION: ProcessDeclaration = parseProcessCatalog({
	processes: {
		"web-serve": {
			description: "the mesh distribution server the phone bootstraps from",
			command: ["/usr/local/bin/refarm", "web", "serve", ".refarm/dist/farm-client"],
			workingDirectory: "/home/op/github/refarm",
			restart: "always",
		},
	},
}).get("web-serve")!;

function ok(stdout: string): CommandResult {
	return { spawned: true, code: 0, stdout, stderr: "" };
}

/** A runner that answers from a script keyed by `argv.join(" ")`. Nothing is ever executed. */
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

const LINGER_OFF = {
	"loginctl show-user op --property=Linger": ok("Linger=no\n"),
};
const LINGER_ON = {
	"loginctl show-user op --property=Linger": ok("Linger=yes\n"),
};

function showUnit(properties: string): Record<string, CommandResult> {
	return {
		"systemctl --user show refarm-web-serve.service --property=LoadState --property=ActiveState --property=SubState":
			ok(properties),
	};
}

function answering(answer: string): OperationConsentChannel & { asked: number } {
	const channel = {
		asked: 0,
		async ask() {
			channel.asked += 1;
			return answer;
		},
	};
	return channel;
}

// Everything below generates units under a THROWAWAY XDG_CONFIG_HOME in the OS temp dir, removed
// afterwards. Nothing is written to ~/.config/systemd, and `systemctl --user enable/start` is never
// run: the runner above is a script, not a shell.
let configHome: string;

beforeEach(async () => {
	configHome = await mkdtemp(path.join(tmpdir(), "refarm-process-unit-"));
});

afterEach(async () => {
	await rm(configHome, { recursive: true, force: true });
});

function backendFor(runner: CommandRunner, existing: Record<string, string> = {}) {
	return createSystemdUserBackend({
		runner,
		user: USER,
		env: { XDG_CONFIG_HOME: configHome },
		async readFile(target) {
			return existing[target] ?? (await readFile(target, "utf8").catch(() => null));
		},
		now: () => "2026-07-31T12:00:00.000Z",
	});
}

describe("preflight decides HOW, and a host without a supervisor refuses honestly", () => {
	it("is ready when a user bus answers", async () => {
		const backend = backendFor(scripted({ "systemctl --user show-environment": ok("LANG=C\n") }));
		expect(await backend.preflight()).toEqual({
			ready: true,
			detail: "systemd --user is running and reachable",
		});
	});

	it("a host with NO systemctl says so and names what belongs there instead — it does not crash", async () => {
		const backend = backendFor(
			scripted({
				"systemctl --user show-environment": {
					spawned: false,
					code: null,
					stdout: "",
					stderr: "systemctl: not found",
				},
			}),
		);
		const readiness = await backend.preflight();
		expect(readiness.ready).toBe(false);
		expect(readiness.detail).toContain("systemctl is not on PATH");
		expect(readiness.fix).toMatch(/Termux or macOS/);
	});

	it("systemctl present but no user bus is its own answer, with its own fix", async () => {
		const backend = backendFor(
			scripted({
				"systemctl --user show-environment": {
					spawned: true,
					code: 1,
					stdout: "",
					stderr: "Failed to connect to bus: No medium found\n",
				},
			}),
		);
		const readiness = await backend.preflight();
		expect(readiness.ready).toBe(false);
		expect(readiness.detail).toContain("could not reach a user bus");
		expect(readiness.fix).toMatch(/XDG_RUNTIME_DIR/);
	});
});

describe("status distinguishes not-running, never-installed and could-not-ask", () => {
	it("reports RUNNING when systemd says active", async () => {
		const backend = backendFor(
			scripted(showUnit("LoadState=loaded\nActiveState=active\nSubState=running\n")),
		);
		const status = await backend.status(DECLARATION);
		expect(status.state).toBe("running");
		expect(status.backend).toBe(SYSTEMD_USER_BACKEND_ID);
		expect(processIsKnownUp(status)).toBe(true);
	});

	it("reports NOT-RUNNING with supervised=true when the unit exists but is dead", async () => {
		const backend = backendFor(
			scripted(showUnit("LoadState=loaded\nActiveState=inactive\nSubState=dead\n")),
		);
		const status = await backend.status(DECLARATION);
		expect(status.state).toBe("not-running");
		expect(status.supervised).toBe(true);
		expect(status.detail).toContain("inactive (dead)");
	});

	it("reports NOT-RUNNING with supervised=false when no unit was ever installed", async () => {
		const backend = backendFor(
			scripted(showUnit("LoadState=not-found\nActiveState=inactive\nSubState=dead\n")),
		);
		const status = await backend.status(DECLARATION);
		expect(status.state).toBe("not-running");
		expect(status.supervised).toBe(false);
		expect(status.detail).toMatch(/refarm process install web-serve/);
	});

	it("reports COULD-NOT-ASK — not 'down' — when systemctl cannot be run at all", async () => {
		const backend = backendFor(scripted({}));
		const status = await createSystemdUserBackend({
			runner: {
				async run() {
					return { spawned: false, code: null, stdout: "", stderr: "systemctl: not found" };
				},
			},
			user: USER,
			env: { XDG_CONFIG_HOME: configHome },
			async readFile() {
				return null;
			},
		}).status(DECLARATION);
		expect(status.state).toBe("could-not-ask");
		expect(status.supervised).toBeNull();
		expect(status.backend).toBeNull();
		expect(processIsKnownUp(status)).toBe(false);
		// And an unparseable answer is also could-not-ask, never a silent "down".
		expect((await backend.status(DECLARATION)).state).toBe("could-not-ask");
	});
});

describe("W3 — the request states the lifetime it ACTUALLY delivers", () => {
	it("with lingering OFF, it says the unit stops at logout and offers linger separately", async () => {
		const backend = backendFor(scripted(LINGER_OFF));
		const plan = await backend.plan(DECLARATION);
		expect(plan.linger).toBe("disabled");
		expect(plan.lifetime).toMatch(/STOPS WHEN YOU LOG OUT/);
		expect(plan.lifetime).toMatch(/SEPARATE operation/);
		expect(plan.lifetime).toContain("refarm process linger");
		expect(plan.request.notes?.[0]).toBe(plan.lifetime);
	});

	it("with lingering ON, it says so — and claims nothing more", async () => {
		const backend = backendFor(scripted(LINGER_ON));
		const plan = await backend.plan(DECLARATION);
		expect(plan.lifetime).toMatch(/KEEPS RUNNING after you log out/);
		expect(plan.lifetime).not.toMatch(/STOPS WHEN YOU LOG OUT/);
	});

	it("when the lingering state cannot be read, it refuses to guess", async () => {
		const backend = backendFor(scripted({}));
		const plan = await backend.plan(DECLARATION);
		expect(plan.linger).toBe("unknown");
		expect(plan.lifetime).toMatch(/could not read the lingering state/);
		expect(plan.lifetime).toMatch(/will not guess/);
	});

	it("says that writing the unit is ALL it does, and names what the operator runs", async () => {
		const plan = await backendFor(scripted(LINGER_OFF)).plan(DECLARATION);
		expect(plan.activationCommands).toEqual([
			"systemctl --user daemon-reload",
			"systemctl --user enable --now refarm-web-serve.service",
		]);
		expect(plan.request.notes?.join("\n")).toMatch(/SÓ ESCREVE O ARQUIVO/);
	});

	it("restarts an active recipe after replacing its unit instead of leaving the old command alive", async () => {
		const previous = renderSystemdUnit({
			...DECLARATION,
			command: ["/usr/local/bin/refarm", "web", "serve", ".refarm/dist"],
		});
		const backend = createSystemdUserBackend({
			runner: scripted(LINGER_OFF),
			user: USER,
			env: { XDG_CONFIG_HOME: configHome },
			async readFile() {
				return previous;
			},
		});
		const plan = await backend.plan(DECLARATION);
		expect(plan.activationCommands).toEqual([
			"systemctl --user daemon-reload",
			"systemctl --user enable refarm-web-serve.service",
			"systemctl --user restart refarm-web-serve.service",
		]);
		expect(plan.request.notes?.join("\n")).toContain(
			"systemctl --user restart refarm-web-serve.service",
		);
	});
});

describe("W2 — the exact unit is shown BEFORE anything is written", () => {
	it("renders the request with the unit text, the path, and the undo", async () => {
		const plan = await backendFor(scripted(LINGER_OFF)).plan(DECLARATION);
		const rendered = renderOperationRequest(plan.request).join("\n");
		expect(rendered).toContain(plan.unitPath);
		expect(rendered).toContain(
			"ExecStart=/usr/local/bin/refarm web serve .refarm/dist/farm-client",
		);
		expect(rendered).toContain("Restart=always");
		expect(rendered).toContain("TimeoutStopSec=20");
		expect(rendered).toMatch(/Desfazer: apaga \//);
		expect(rendered).toContain("systemctl --user disable --now refarm-web-serve.service");
		expect(rendered).toMatch(/STOPS WHEN YOU LOG OUT/);
	});

	it("shows the request before the file exists — nothing is written by planning", async () => {
		const plan = await backendFor(scripted(LINGER_OFF)).plan(DECLARATION);
		expect(plan.unitPath).toBe(systemdUnitPath("web-serve", { XDG_CONFIG_HOME: configHome }));
		await expect(stat(plan.unitPath)).rejects.toThrow();
	});
});

describe("the consent journey writes the unit, and its undo REMOVES it", () => {
	async function install(answer: string): Promise<{
		unitPath: string;
		record: OperationRecord | null;
		trail: ReturnType<typeof createMemoryOperationTrail>;
	}> {
		const plan = await backendFor(scripted(LINGER_OFF)).plan(DECLARATION);
		const trail = createMemoryOperationTrail();
		const outcome = await runOperationConsent({
			request: plan.request,
			trail,
			channel: answering(answer),
			fs: createNodeOperationFileSystem(),
			now: () => "2026-07-31T12:00:01.000Z",
			decidedBy: USER,
		});
		return { unitPath: plan.unitPath, record: outcome.record, trail };
	}

	it("declining writes nothing at all", async () => {
		const { unitPath, record } = await install("decline");
		await expect(stat(unitPath)).rejects.toThrow();
		expect(record?.decision).toBe("declined");
	});

	it("authorising writes exactly the unit that was shown", async () => {
		const { unitPath, record } = await install("authorize");
		const written = await readFile(unitPath, "utf8");
		expect(written).toBe(record?.changes[0]?.after);
		expect(written).toContain("ExecStart=/usr/local/bin/refarm web serve");
		expect(written).toContain("TimeoutStopSec=20");
	});

	it("APPLYING the undo removes the unit from the disk", async () => {
		const { unitPath, record, trail } = await install("authorize");
		await stat(unitPath); // it is there

		const undone = await undoOperationRecord({
			record: record!,
			trail,
			fs: createNodeOperationFileSystem(),
			now: () => "2026-07-31T12:00:02.000Z",
		});

		await expect(stat(unitPath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(undone.decision).toBe("undone");
		expect(undone.changes[0]?.after).toBeNull();
		expect((await trail.read()).map((r) => r.decision)).toEqual(["authorized", "undone"]);
	});
});

describe("lingering may not be bundled into a unit installation", () => {
	it("the unit request touches the unit file and nothing else", async () => {
		const plan = await backendFor(scripted(LINGER_OFF)).plan(DECLARATION);
		expect(plan.request.changes).toHaveLength(1);
		expect(plan.request.changes[0]?.path).toBe(plan.unitPath);
		expect(plan.request.changes.some((c) => c.path.startsWith(`${LINGER_DIR}/`))).toBe(false);
		expect(plan.request.changes.some((c) => c.path === lingerMarkerPath(USER))).toBe(false);
	});

	it("a plan that tried to bundle lingering would be REFUSED before consent ran", async () => {
		// The rule is enforced structurally inside `plan()`; this proves the enforcement is live by
		// feeding the same guard the request a bundling backend would have produced.
		const plan = await backendFor(scripted(LINGER_OFF)).plan(DECLARATION);
		const { refuseBundledLinger } = await import("./linger.js");
		expect(() =>
			refuseBundledLinger({
				...plan.request,
				changes: [
					...plan.request.changes,
					{ path: lingerMarkerPath(USER), before: null, after: "" },
				],
			}),
		).toThrow(SupervisionRefusal);
		expect(() =>
			refuseBundledLinger({
				...plan.request,
				changes: [
					...plan.request.changes,
					{ path: lingerMarkerPath(USER), before: null, after: "" },
				],
			}),
		).toThrow(/a small yes may not be turned into a large one by bundling/);
	});
});
