import { describe, expect, it } from "vitest";
import {
	runLoginFlow,
	spawnLoginProcess,
	type LoginFlowEvent,
	type LoginFlowProcess,
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
