import { describe, expect, it } from "vitest";
import {
	runLoginFlow,
	spawnLoginProcess,
	superviseConnection,
	type ConnectionSupervisor,
	type LoginFlowEvent,
	type LoginFlowProcess,
	type SuperviseEvent,
} from "./index.js";

/** A fake process: the test drives its output with `emit`, inspects stdin via `written`, and can
 * make it exit — so the whole state machine is exercised with no real process. */
function makeFake() {
	let listener: ((chunk: string) => void) | undefined;
	const written: string[] = [];
	let killed = false;
	let resolveExit!: (code: number) => void;
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const proc: LoginFlowProcess = {
		onData(l) {
			listener = l;
		},
		write(input) {
			written.push(input);
		},
		kill() {
			killed = true;
			resolveExit(143);
		},
		exited,
	};
	return {
		proc,
		written,
		isKilled: () => killed,
		emit: (chunk: string) => listener?.(chunk),
		exit: (code: number) => resolveExit(code),
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runLoginFlow — the connect/login state machine", () => {
	it("resolves ready when the ready pattern appears, and LEAVES the process running", async () => {
		const fake = makeFake();
		const result = runLoginFlow({ spawn: () => fake.proc, ready: /Conectado/, fail: /auth-failure/ });
		fake.emit("Conectando\n");
		fake.emit("Conectado\n");

		const outcome = await result;
		expect(outcome.ok).toBe(true);
		expect(outcome.reason).toBe("ready");
		expect(fake.isKilled()).toBe(false); // a VPN CLI holds the tunnel — must not be killed
	});

	it("fails (and kills the process) when the fail pattern appears", async () => {
		const fake = makeFake();
		const result = runLoginFlow({ spawn: () => fake.proc, ready: /Conectado/, fail: /Saindo: auth-failure/ });
		fake.emit("Conectando\n");
		fake.emit("Saindo: auth-failure\n");

		const outcome = await result;
		expect(outcome.ok).toBe(false);
		expect(outcome.reason).toBe("fail");
		expect(fake.isKilled()).toBe(true);
	});

	it("answers a prompt via stdin and never leaks the secret into the transcript", async () => {
		const fake = makeFake();
		const events: LoginFlowEvent[] = [];
		const result = runLoginFlow({
			spawn: () => fake.proc,
			ready: /Conectado/,
			prompts: [
				{
					match: /Senha \((.*)\): /,
					respond: (m) => `super-secret-for-${m[1]}`,
					label: "token-password",
				},
			],
			onEvent: (e) => events.push(e),
		});

		fake.emit("Senha (TOKEN-X): "); // a prompt with NO trailing newline
		await flush(); // let the async respond write to stdin
		expect(fake.written).toContain("super-secret-for-TOKEN-X\n");

		fake.emit("Conectado\n");
		const outcome = await result;

		expect(outcome.ok).toBe(true);
		expect(events.some((e) => e.kind === "prompt" && e.message === "token-password")).toBe(true);
		// the secret went to stdin only — it is not in the transcript or any event
		expect(outcome.transcript).not.toContain("super-secret");
		expect(JSON.stringify(events)).not.toContain("super-secret");
	});

	it("surfaces a human notice (e.g. approve-on-phone) without settling the flow", async () => {
		const fake = makeFake();
		const events: LoginFlowEvent[] = [];
		const result = runLoginFlow({
			spawn: () => fake.proc,
			ready: /Conectado/,
			notices: [{ match: /Conectando/, message: "Aprove a conexão no seu celular (SerproID)" }],
			onEvent: (e) => events.push(e),
		});

		fake.emit("Conectando\n");
		fake.emit("Conectado\n");
		await result;

		const notice = events.find((e) => e.kind === "notice");
		expect(notice?.message).toBe("Aprove a conexão no seu celular (SerproID)");
	});

	it("times out (and kills the process) if ready never arrives — deterministic via injected timer", async () => {
		const fake = makeFake();
		let fire: () => void = () => {};
		const result = runLoginFlow({
			spawn: () => fake.proc,
			ready: /Conectado/,
			timeoutMs: 1_000,
			setTimer: (cb) => {
				fire = cb;
				return () => {};
			},
		});

		fake.emit("Conectando\n");
		fire(); // trigger the timeout

		const outcome = await result;
		expect(outcome.reason).toBe("timeout");
		expect(outcome.ok).toBe(false);
		expect(fake.isKilled()).toBe(true);
	});

	it("treats the process exiting before ready as a failure", async () => {
		const fake = makeFake();
		const result = runLoginFlow({ spawn: () => fake.proc, ready: /Conectado/ });
		fake.emit("Conectando\n");
		fake.exit(1);

		const outcome = await result;
		expect(outcome.reason).toBe("exit");
		expect(outcome.ok).toBe(false);
	});
});

/** A process that auto-emits its scripted output once a listener attaches — so the supervisor's
 * internal runLoginFlow calls resolve without the test driving each emit. */
function autoProcess(script: string, opts?: { exitCode?: number }): LoginFlowProcess {
	let resolveExit!: (code: number) => void;
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	return {
		onData(cb) {
			queueMicrotask(() => {
				cb(script);
				if (opts?.exitCode !== undefined) resolveExit(opts.exitCode);
			});
		},
		write() {},
		kill() {
			resolveExit(143);
		},
		exited,
	};
}

const macroSleep = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(cond: () => boolean, timeoutMs = 1_000): Promise<void> {
	const started = Date.now();
	while (!cond()) {
		if (Date.now() - started > timeoutMs) throw new Error("waitFor: condition not met in time");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe("superviseConnection — keep it up, feel the drop early", () => {
	it("connects, resolves `connected`, and tears down on stop()", async () => {
		const events: SuperviseEvent["kind"][] = [];
		const sup = superviseConnection({
			flow: { spawn: () => autoProcess("Conectado\n"), ready: /Conectado/ },
			isHealthy: () => true,
			healthIntervalMs: 0,
			sleep: macroSleep,
			onEvent: (e) => events.push(e.kind),
		});

		await sup.connected;
		await sup.stop();

		expect(events[0]).toBe("connected");
		expect(events).toContain("stopped");
		expect((await sup.closed).reason).toBe("stopped"); // closed resolves so a consumer can exit
	});

	it("reconnects the instant health drops (feel the pain early)", async () => {
		const events: SuperviseEvent["kind"][] = [];
		const health = [true, true, false]; // healthy twice, then the tunnel drops
		let i = 0;
		let sup!: ConnectionSupervisor;
		sup = superviseConnection({
			flow: { spawn: () => autoProcess("Conectado\n"), ready: /Conectado/ },
			isHealthy: () => health[i++] ?? true,
			healthIntervalMs: 0,
			sleep: macroSleep,
			onEvent: (e) => {
				events.push(e.kind);
				if (e.kind === "reconnected") void sup.stop(); // end deterministically
			},
		});

		await sup.connected;
		await waitFor(() => events.includes("reconnected"));

		expect(events).toEqual(["connected", "dropped", "reconnected", "stopped"]);
	});

	it("gives up after maxAttempts consecutive failures and rejects `connected`", async () => {
		const events: SuperviseEvent["kind"][] = [];
		const sup = superviseConnection({
			// exits before ready → each attempt fails
			flow: { spawn: () => autoProcess("iniciando\n", { exitCode: 1 }), ready: /Conectado/ },
			isHealthy: () => true,
			maxAttempts: 2,
			backoffMs: 0,
			sleep: macroSleep,
			onEvent: (e) => events.push(e.kind),
		});

		await expect(sup.connected).rejects.toThrow("gave up");
		expect(events).toEqual(["reconnecting", "reconnecting", "gaveup"]);
		expect((await sup.closed).reason).toBe("gaveup"); // closed resolves → consumer exits, no idle hang
	});
});

describe("spawnLoginProcess — the real node:child_process adapter", () => {
	it("drives a REAL process to ready (end-to-end, no fake)", async () => {
		const outcome = await runLoginFlow({
			spawn: () =>
				spawnLoginProcess("node", ["-e", "process.stdout.write('Conectando\\nConectado\\n')"]),
			ready: /Conectado/,
			fail: /auth-failure/,
			timeoutMs: 5_000,
		});

		expect(outcome.ok).toBe(true);
		expect(outcome.reason).toBe("ready");
		expect(outcome.transcript).toContain("Conectado");
		outcome.process.kill(); // leave-running-on-success → clean up the (already-exited) process
	});
});
