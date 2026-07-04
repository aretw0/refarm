import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import { runProcessHandoffSync } from "@refarm.dev/cli/process-handoff";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * The OS process-stop engine for `refarm runtime stop` — extracted verbatim from
 * runtime.ts to keep that file to its commander wiring. Locates tractor/farmhand
 * processes by PID file, process scan, and port scan, terminates them, and shapes
 * the stop result + its JSON payload. Pure of any status/diagnostics concern, so
 * it forms no cycle with runtime-status.ts.
 */

export const RUNTIME_STOP_JSON_COMMAND = refarmCommand([
	"runtime",
	"stop",
	"--json",
]);

export interface RuntimeStopResult {
	ok: boolean;
	stopped: boolean;
	alreadyStopped?: boolean;
	pid?: number;
	pidFile: string;
	targets?: RuntimeStopTargetResult[];
	message?: string;
}

export interface RuntimeStopTargetResult {
	name: "tractor" | "farmhand";
	ok: boolean;
	stopped: boolean;
	alreadyStopped?: boolean;
	pid?: number;
	pidFile: string;
	source?: "pid-file" | "process-scan" | "port-scan";
	orphan?: boolean;
	message?: string;
}

export type RuntimeStopJsonPayload = RuntimeStopResult & {
	command: "runtime";
	operation: "stop";
	nextAction: null;
	nextActions: [];
	nextCommand: null;
	nextCommands: [];
};

function procCmdline(pid: number): string[] | null {
	if (process.platform !== "linux") return null;
	const procRoot = process.env.REFARM_PROC_ROOT ?? "/proc";
	try {
		return parseProcCmdline(readFileSync(join(procRoot, String(pid), "cmdline"), "utf-8"));
	} catch {
		return null;
	}
}

function isFarmhandProcess(args: string[]): boolean {
	return args.some((arg) => arg.includes("farmhand"));
}

function runtimePidMatchesTarget(
	name: RuntimeStopTargetResult["name"],
	pid: number,
): boolean | null {
	const args = procCmdline(pid);
	if (!args) return null;
	if (name === "tractor") return args.some(isTractorArg);
	return isFarmhandProcess(args);
}

function stopRuntimeTarget(
	name: RuntimeStopTargetResult["name"],
	pidFile: string,
): RuntimeStopTargetResult {
	if (!existsSync(pidFile)) {
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pidFile,
			source: "pid-file",
			message: `No ${name} PID file found.`,
		};
	}

	const raw = readFileSync(pidFile, "utf-8").trim();
	const pid = Number.parseInt(raw, 10);
	if (!Number.isFinite(pid) || pid <= 0) {
		try {
			unlinkSync(pidFile);
		} catch {
			// Best-effort cleanup; the invalid PID is the primary error.
		}
		return {
			name,
			ok: false,
			stopped: false,
			pidFile,
			source: "pid-file",
			message: `Invalid ${name} PID in ${pidFile}: ${raw}`,
		};
	}

	try {
		process.kill(pid, 0);
	} catch {
		try {
			unlinkSync(pidFile);
		} catch {
			// Best-effort cleanup; stale PID is already handled.
		}
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pid,
			pidFile,
			source: "pid-file",
			message: `${name} process was not running; cleaned PID file.`,
		};
	}

	if (runtimePidMatchesTarget(name, pid) === false) {
		try {
			unlinkSync(pidFile);
		} catch {
			// Best-effort cleanup; mismatched PID is already handled.
		}
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pid,
			pidFile,
			source: "pid-file",
			message: `${name} PID file pointed at a different process; cleaned PID file.`,
		};
	}

	try {
		process.kill(pid, "SIGTERM");
		unlinkSync(pidFile);
		return {
			name,
			ok: true,
			stopped: true,
			pid,
			pidFile,
			source: "pid-file",
		};
	} catch (error) {
		return {
			name,
			ok: false,
			stopped: false,
			pid,
			pidFile,
			source: "pid-file",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function parseProcCmdline(raw: string): string[] {
	return raw.split("\0").filter((part) => part.length > 0);
}

function isTractorArg(arg: string): boolean {
	const normalized = arg.replace(/\\/g, "/");
	return normalized === "tractor" || normalized.endsWith("/tractor");
}

function argValue(args: string[], name: string): string | null {
	const index = args.indexOf(name);
	if (index >= 0) return args[index + 1] ?? null;
	const prefix = `${name}=`;
	const value = args.find((arg) => arg.startsWith(prefix));
	return value ? value.slice(prefix.length) : null;
}

function hasExplicitRuntimePorts(args: string[]): boolean {
	return argValue(args, "--port") !== null || argValue(args, "--http-port") !== null;
}

function tractorProcessBelongsToRepo(args: string[], repoRoot: string): boolean {
	const normalizedRepoRoot = repoRoot.replace(/\\/g, "/");
	return args.some((arg) => arg.replace(/\\/g, "/").startsWith(normalizedRepoRoot));
}

function findDefaultPortTractorProcesses(repoRoot: string): number[] {
	if (process.platform !== "linux") return [];
	const procRoot = process.env.REFARM_PROC_ROOT ?? "/proc";
	let entries: string[];
	try {
		entries = readdirSync(procRoot);
	} catch {
		return [];
	}
	const currentPid = process.pid;
	const pids: number[] = [];
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		const pid = Number.parseInt(entry, 10);
		if (!Number.isFinite(pid) || pid <= 0 || pid === currentPid) continue;
		let args: string[];
		try {
			args = parseProcCmdline(readFileSync(join(procRoot, entry, "cmdline"), "utf-8"));
		} catch {
			continue;
		}
		if (args.length === 0 || !isTractorArg(args[0]!)) continue;
		if (hasExplicitRuntimePorts(args)) continue;
		if (!tractorProcessBelongsToRepo(args, repoRoot)) continue;
		pids.push(pid);
	}
	return pids;
}

function parseDefaultPortRuntimeSocketProcesses(output: string): number[] {
	const pids = new Set<number>();
	for (const line of output.split(/\r?\n/)) {
		if (!/:(42000|42001)\b/.test(line)) continue;
		if (!line.includes('"tractor"') && !line.includes('"farmhand"')) continue;
		for (const match of line.matchAll(/\bpid=(\d+)\b/g)) {
			const pid = Number.parseInt(match[1]!, 10);
			if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
				pids.add(pid);
			}
		}
	}
	return [...pids];
}

function findDefaultPortRuntimeSocketProcesses(): number[] {
	const configuredOutput = process.env.REFARM_SS_OUTPUT;
	if (configuredOutput !== undefined) {
		return parseDefaultPortRuntimeSocketProcesses(configuredOutput);
	}
	if (process.env.NODE_ENV === "test" || process.env.VITEST) return [];
	if (process.platform !== "linux") return [];
	const result = runProcessHandoffSync(
		{
			command: "ss",
			args: ["-tlnp"],
			display: "ss -tlnp",
		},
		{ capture: true },
	);
	if (result.exitCode !== 0) return [];
	return parseDefaultPortRuntimeSocketProcesses(result.stdout ?? "");
}

function stopRuntimePid(
	name: RuntimeStopTargetResult["name"],
	pid: number,
	pidFile: string,
	source: RuntimeStopTargetResult["source"],
	orphan = false,
): RuntimeStopTargetResult {
	try {
		process.kill(pid, 0);
	} catch {
		return {
			name,
			ok: true,
			stopped: false,
			alreadyStopped: true,
			pid,
			pidFile,
			source,
			...(orphan ? { orphan: true } : {}),
			message: `${name} process was not running.`,
		};
	}
	try {
		process.kill(pid, "SIGTERM");
		return {
			name,
			ok: true,
			stopped: true,
			pid,
			pidFile,
			source,
			...(orphan ? { orphan: true } : {}),
		};
	} catch (error) {
		return {
			name,
			ok: false,
			stopped: false,
			pid,
			pidFile,
			source,
			...(orphan ? { orphan: true } : {}),
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export function stopRuntimeProcess(repoRoot: string): RuntimeStopResult {
	const tractorPidFile = join(repoRoot, ".refarm", "tractor.pid");
	const farmhandPidFile = join(repoRoot, ".refarm", "farmhand.pid");
	const targets = [
		stopRuntimeTarget("tractor", tractorPidFile),
		stopRuntimeTarget("farmhand", farmhandPidFile),
	];
	const knownPids = new Set(
		targets.flatMap((target) => (target.pid ? [target.pid] : [])),
	);
	for (const pid of findDefaultPortTractorProcesses(repoRoot)) {
		if (knownPids.has(pid)) continue;
		targets.push(stopRuntimePid("tractor", pid, tractorPidFile, "process-scan", true));
		knownPids.add(pid);
	}
	for (const pid of findDefaultPortRuntimeSocketProcesses()) {
		if (knownPids.has(pid)) continue;
		targets.push(stopRuntimePid("tractor", pid, tractorPidFile, "port-scan", true));
		knownPids.add(pid);
	}
	const failed = targets.find((target) => !target.ok);
	const stopped = targets.filter((target) => target.stopped);
	const primary = failed ?? stopped[0] ?? targets[0]!;
	return {
		ok: !failed,
		stopped: stopped.length > 0,
		alreadyStopped: stopped.length === 0 && !failed,
		...(stopped.length === 1 && stopped[0]?.pid ? { pid: stopped[0].pid } : {}),
		pidFile: primary.pidFile,
		targets,
		message: failed
			? failed.message
			: stopped.length > 0
				? `Stopped ${stopped.map((target) => target.name).join(", ")} runtime process${stopped.length === 1 ? "" : "es"}.`
				: "No runtime PID files found.",
	};
}

export function buildRuntimeStopJsonPayload(
	result: RuntimeStopResult,
): RuntimeStopJsonPayload {
	return {
		command: "runtime",
		operation: "stop",
		...result,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}
