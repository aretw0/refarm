import { existsSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const DEFAULT_FACTORY_PRESSURE_THRESHOLDS = {
	diskWarnFreeBytes: 10 * GB,
	diskBlockFreeBytes: 3 * GB,
	memoryWarnFreeBytes: 1536 * MB,
	memoryBlockFreeBytes: 512 * MB,
	memoryWarnUsedRatio: 0.88,
	memoryBlockUsedRatio: 0.95,
};

export function bytesToMiB(value) {
	return Math.round(value / MB);
}

export function classifyDiskPressure(freeBytes, thresholds = DEFAULT_FACTORY_PRESSURE_THRESHOLDS) {
	if (freeBytes < thresholds.diskBlockFreeBytes) {
		return "failure";
	}
	if (freeBytes < thresholds.diskWarnFreeBytes) {
		return "warning";
	}
	return "info";
}

export function classifyMemoryPressure(memory, thresholds = DEFAULT_FACTORY_PRESSURE_THRESHOLDS) {
	const usedRatio = memory.totalBytes > 0 ? 1 - memory.freeBytes / memory.totalBytes : 0;
	if (
		memory.freeBytes < thresholds.memoryBlockFreeBytes &&
		usedRatio >= thresholds.memoryBlockUsedRatio
	) {
		return "failure";
	}
	if (
		memory.freeBytes < thresholds.memoryWarnFreeBytes ||
		usedRatio >= thresholds.memoryWarnUsedRatio
	) {
		return "warning";
	}
	return "info";
}

export function decideFactoryPressure(signals) {
	if (signals.some((signal) => signal.severity === "failure")) {
		return "stop-and-investigate";
	}
	if (signals.some((signal) => signal.severity === "warning")) {
		return "safe-mode";
	}
	return "continue";
}

export function buildFactoryPressureReport(options = {}) {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	const thresholds = {
		...DEFAULT_FACTORY_PRESSURE_THRESHOLDS,
		...(options.thresholds ?? {}),
	};
	const env = options.env ?? process.env;
	const osApi = options.os ?? os;
	const exists = options.existsSync ?? existsSync;
	const statfs = options.statfsSync ?? statfsSync;
	const now = options.now ?? new Date();
	const signals = [];

	try {
		const stats = statfs(cwd);
		const freeBytes = Number(stats.bavail) * Number(stats.bsize);
		const totalBytes = Number(stats.blocks) * Number(stats.bsize);
		const severity = classifyDiskPressure(freeBytes, thresholds);
		signals.push({
			id: "filesystem-free-space",
			kind: "filesystem",
			severity,
			ok: severity !== "failure",
			path: cwd,
			freeMiB: bytesToMiB(freeBytes),
			totalMiB: bytesToMiB(totalBytes),
			summary:
				severity === "info"
					? "Workspace filesystem has enough free space for focused work."
					: "Workspace filesystem is under disk pressure.",
			action:
				severity === "info"
					? null
					: "Run `pnpm run clean:rust:check`, then choose the smallest cleanup tier from docs/local-disk-hygiene.md before broad builds.",
			command: severity === "info" ? null : "pnpm run clean:rust:check",
		});
	} catch (error) {
		signals.push({
			id: "filesystem-free-space",
			kind: "filesystem",
			severity: "warning",
			ok: true,
			path: cwd,
			summary: "Workspace filesystem free-space probe failed.",
			action: "Run `pnpm run disk:check` only if disk pressure is suspected.",
			command: "pnpm run disk:check",
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const totalBytes = Number(osApi.totalmem?.() ?? 0);
	const freeBytes = Number(osApi.freemem?.() ?? 0);
	const memorySeverity = classifyMemoryPressure({ totalBytes, freeBytes }, thresholds);
	signals.push({
		id: "host-memory-available",
		kind: "memory",
		severity: memorySeverity,
		ok: memorySeverity !== "failure",
		freeMiB: bytesToMiB(freeBytes),
		totalMiB: bytesToMiB(totalBytes),
		usedRatio: totalBytes > 0 ? Number((1 - freeBytes / totalBytes).toFixed(3)) : null,
		summary:
			memorySeverity === "info"
				? "Host memory has enough headroom for focused work."
				: "Host memory is tight; broad worker fan-out can stall the devcontainer.",
		action:
			memorySeverity === "info"
				? null
				: "Use explicit test files, bounded workers, and package-scoped checks until memory pressure drops.",
	});

	const gitGcLogPath = path.join(cwd, ".git", "gc.log");
	if (exists(gitGcLogPath)) {
		signals.push({
			id: "git-gc-log-present",
			kind: "git",
			severity: "warning",
			ok: true,
			path: gitGcLogPath,
			summary: "Git left a gc.log marker; automatic maintenance may be disabled until inspected.",
			action:
				"Inspect `.git/gc.log`; do not run prune or destructive Git cleanup from an agent without explicit operator intent.",
		});
	}

	const cargoTargetDir = env.CARGO_TARGET_DIR ? path.resolve(cwd, env.CARGO_TARGET_DIR) : null;
	if (cargoTargetDir) {
		signals.push({
			id: "cargo-target-dir",
			kind: "cache",
			severity: "info",
			ok: true,
			path: cargoTargetDir,
			summary: "Rust builds are routed through CARGO_TARGET_DIR.",
			action: null,
		});
	}

	const decision = decideFactoryPressure(signals);
	const recommendations = signals
		.filter((signal) => signal.action)
		.map((signal) => ({
			diagnostic: `factory-pressure:${signal.id}`,
			severity: signal.severity,
			summary: signal.summary,
			action: signal.action,
			command: signal.command ?? undefined,
			target: signal.path ?? signal.kind,
		}));
	const nextCommands = recommendations
		.map((recommendation) => recommendation.command)
		.filter((command, index, all) => command && all.indexOf(command) === index);
	const nextActions = recommendations.map((recommendation) => recommendation.action);

	return {
		schemaVersion: 1,
		command: "factory-pressure",
		operation: "check",
		ok: decision !== "stop-and-investigate",
		decision,
		generatedAt: now.toISOString(),
		cwd,
		signals,
		recommendations,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}
