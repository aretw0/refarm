import { probeRuntimeLiveness } from "@refarm.dev/runtime-operator";
import { type ChildProcess, spawn } from "node:child_process";

/**
 * Spawn and supervise the native tractor runtime daemon — the WASM plugin host.
 *
 * A white-label app dispatches verbs to plugins over the runtime's HTTP sidecar; this
 * is how the app STARTS that runtime. It spawns the compiled `tractor` binary with the
 * plugins to load (`--plugin <wasm>`, repeatable), waits until the sidecar answers, and
 * hands back the sidecar base URL plus a stop() handle. The execution is real: each
 * `.wasm` is loaded and run by wasmtime inside the daemon, exactly as in production.
 *
 * This is the seam the exploratory `serve` command builds on, and the seam a
 * TS-driven execution test drives to prove dispatch reaches a real plugin.
 *
 * It is DISTINCT from @refarm.dev/runtime-operator's launcher: that one autostarts the
 * production daemon (start-script or binary-on-PATH; plugins come from config/farmhand),
 * whereas this spawns the binary with EXPLICIT `--plugin <wasm>` paths — what a test or
 * a self-contained demo needs. Readiness is shared: it delegates to the operator's probe
 * rather than reimplementing the poll.
 */

export interface RuntimeDaemonOptions {
	/** Path to the compiled tractor binary. Defaults to the repo's release build. */
	binaryPath?: string;
	/** WASM plugin paths to load at boot (`--plugin`, repeatable). Order is preserved:
	 * load an SPI provider before its consumer for the common (order-immune) case. */
	plugins?: readonly string[];
	/** Storage namespace. `:memory:` keeps the run ephemeral (nothing persisted). */
	namespace?: string;
	/** WebSocket daemon port. */
	wsPort?: number;
	/** HTTP sidecar port — where dispatch efforts are POSTed. */
	httpPort?: number;
	/** Security mode. `none` is for local demos/tests; real installs use `strict`. */
	securityMode?: "strict" | "permissive" | "none";
	/** Log level for the daemon's stderr. */
	logLevel?: "trace" | "debug" | "info" | "warn" | "error";
	/** How long to wait for the sidecar to answer before giving up (ms). Loading
	 * several 12 MB components takes a few seconds each, so this defaults generously. */
	readyTimeoutMs?: number;
	/** Poll interval while waiting for readiness (ms). */
	readyPollMs?: number;
	/** Extra environment for the daemon process. */
	env?: NodeJS.ProcessEnv;
}

/** A running runtime daemon: where to reach it, and how to stop it. */
export interface RuntimeDaemonHandle {
	/** The HTTP sidecar base URL (e.g. `http://127.0.0.1:42001`) — dispatch efforts go here. */
	sidecarBaseUrl: string;
	/** The WebSocket daemon base URL. */
	wsBaseUrl: string;
	/** The child process, for advanced supervision. */
	process: ChildProcess;
	/** Stop the daemon and wait for it to exit. Idempotent. */
	stop(): Promise<void>;
}

const DEFAULT_BINARY = ".cache/cargo-target/release/tractor";

/** The default tractor binary path, resolved against the current working directory.
 * Overridable via the `TRACTOR_BINARY` env var (an out-of-tree install or a debug build). */
export function defaultTractorBinaryPath(env: NodeJS.ProcessEnv = process.env): string {
	return env.TRACTOR_BINARY ?? DEFAULT_BINARY;
}

/** Is the sidecar answering yet? Delegates to the shared runtime-operator liveness
 * probe (the same one the refarm app uses) — this module only adds the plugin-explicit
 * spawn that tests need, not its own probe logic. */
async function sidecarIsReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
	return (await probeRuntimeLiveness(baseUrl, timeoutMs)).ready;
}

/**
 * Start the runtime daemon and resolve once its sidecar is reachable. Rejects (after
 * stopping the child) if the daemon exits early or the sidecar never answers in time.
 */
export async function startRuntimeDaemon(
	options: RuntimeDaemonOptions = {},
): Promise<RuntimeDaemonHandle> {
	const binaryPath = options.binaryPath ?? defaultTractorBinaryPath(options.env);
	const namespace = options.namespace ?? ":memory:";
	const wsPort = options.wsPort ?? 42000;
	const httpPort = options.httpPort ?? 42001;
	const securityMode = options.securityMode ?? "none";
	const logLevel = options.logLevel ?? "warn";
	const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
	const readyPollMs = options.readyPollMs ?? 250;

	const args = [
		"--namespace",
		namespace,
		"--port",
		String(wsPort),
		"--http-port",
		String(httpPort),
		"--security-mode",
		securityMode,
		"--log-level",
		logLevel,
	];
	for (const plugin of options.plugins ?? []) {
		args.push("--plugin", plugin);
	}

	const child = spawn(binaryPath, args, {
		env: { ...process.env, REFARM_NAMESPACE: namespace, ...options.env },
		stdio: ["ignore", "ignore", "pipe"],
	});

	const sidecarBaseUrl = `http://127.0.0.1:${httpPort}`;
	const wsBaseUrl = `http://127.0.0.1:${wsPort}`;

	let stopped = false;
	const stop = async (): Promise<void> => {
		if (stopped) return;
		stopped = true;
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			await new Promise<void>((resolve) => {
				const t = setTimeout(() => {
					child.kill("SIGKILL");
					resolve();
				}, 3_000);
				child.once("exit", () => {
					clearTimeout(t);
					resolve();
				});
			});
		}
	};

	// If the daemon dies before readiness, surface that instead of hanging.
	type ExitInfo = { code: number | null; signal: NodeJS.Signals | null };
	const exitState: { info: ExitInfo | null; spawnError: Error | null } = {
		info: null,
		spawnError: null,
	};
	child.once("exit", (code, signal) => {
		exitState.info = { code, signal };
	});
	// A spawn failure (e.g. ENOENT: binary missing) emits 'error', not 'exit'. Capture
	// it so the readiness loop rejects cleanly instead of the event going uncaught.
	child.once("error", (err) => {
		exitState.spawnError = err;
	});

	const handle: RuntimeDaemonHandle = { sidecarBaseUrl, wsBaseUrl, process: child, stop };

	const deadline = Date.now() + readyTimeoutMs;
	// Date.now() is fine here (Node, not a workflow script) — this is wall-clock polling.
	while (Date.now() < deadline) {
		if (exitState.spawnError) {
			await stop();
			throw new Error(
				`failed to spawn the tractor daemon at ${binaryPath}: ${exitState.spawnError.message}`,
			);
		}
		if (exitState.info) {
			const { code, signal } = exitState.info;
			await stop();
			throw new Error(
				`tractor daemon exited before the sidecar was ready (code=${code}, signal=${signal}). Is the binary at ${binaryPath}?`,
			);
		}
		if (await sidecarIsReady(sidecarBaseUrl, 1_000)) return handle;
		await new Promise((r) => setTimeout(r, readyPollMs));
	}
	await stop();
	throw new Error(
		`tractor sidecar did not become ready within ${readyTimeoutMs}ms at ${sidecarBaseUrl}`,
	);
}
