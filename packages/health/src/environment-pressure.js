import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/**
 * @typedef {"info" | "warning" | "failure"} EnvironmentPressureSeverity
 * @typedef {"continue" | "safe-mode" | "stop-and-investigate"} EnvironmentPressureDecision
 *
 * @typedef EnvironmentPressureThresholds
 * @property {number} diskWarnFreeBytes
 * @property {number} diskBlockFreeBytes
 * @property {number} memoryWarnFreeBytes
 * @property {number} memoryBlockFreeBytes
 * @property {number} memoryWarnUsedRatio
 * @property {number} memoryBlockUsedRatio
 *
 * @typedef EnvironmentPressureGuidance
 * @property {string} [diskPressureAction]
 * @property {string | null} [diskPressureCommand]
 * @property {string} [diskProbeFailureAction]
 * @property {string | null} [diskProbeFailureCommand]
 * @property {string} [memoryPressureAction]
 * @property {string} [gitGcLogAction]
 *
 * @typedef EnvironmentPressureSignal
 * @property {string} id
 * @property {"filesystem" | "memory" | "git" | "cache"} kind
 * @property {EnvironmentPressureSeverity} severity
 * @property {boolean} ok
 * @property {string} summary
 * @property {string | null} action
 * @property {string | null} [command]
 * @property {string} [path]
 * @property {number} [freeMiB]
 * @property {number} [totalMiB]
 * @property {number | null} [usedRatio]
 * @property {string} [error]
 *
 * @typedef EnvironmentPressureRecommendation
 * @property {string} diagnostic
 * @property {EnvironmentPressureSeverity} severity
 * @property {string} summary
 * @property {string} action
 * @property {string} [command]
 * @property {string} target
 *
 * @typedef EnvironmentPressureReport
 * @property {1} schemaVersion
 * @property {string} command
 * @property {string} operation
 * @property {boolean} ok
 * @property {EnvironmentPressureDecision} decision
 * @property {string} generatedAt
 * @property {string} cwd
 * @property {EnvironmentPressureSignal[]} signals
 * @property {EnvironmentPressureRecommendation[]} recommendations
 * @property {string | null} nextAction
 * @property {string[]} nextActions
 * @property {string | null} nextCommand
 * @property {string[]} nextCommands
 *
 * @typedef EnvironmentPressureOptions
 * @property {string} [cwd]
 * @property {string} [command]
 * @property {string} [operation]
 * @property {Partial<EnvironmentPressureThresholds>} [thresholds]
 * @property {Record<string, string | undefined>} [env]
 * @property {{ totalmem?: () => number, freemem?: () => number }} [os]
 * @property {{ statfsSync: (path: string) => { bavail: number | bigint, bsize: number | bigint, blocks: number | bigint }, existsSync: (path: string) => boolean }} [fs]
 * @property {Date} [now]
 * @property {EnvironmentPressureGuidance} [guidance]
 */

/** @type {EnvironmentPressureThresholds} */
export const DEFAULT_ENVIRONMENT_PRESSURE_THRESHOLDS = {
    diskWarnFreeBytes: 10 * GiB,
    diskBlockFreeBytes: 3 * GiB,
    memoryWarnFreeBytes: 1536 * MiB,
    memoryBlockFreeBytes: 512 * MiB,
    memoryWarnUsedRatio: 0.88,
    memoryBlockUsedRatio: 0.95,
};

/**
 * @param {number} value
 * @returns {number}
 */
export function bytesToMiB(value) {
    return Math.round(value / MiB);
}

/**
 * @param {number} freeBytes
 * @param {EnvironmentPressureThresholds} [thresholds]
 * @returns {EnvironmentPressureSeverity}
 */
export function classifyDiskPressure(
    freeBytes,
    thresholds = DEFAULT_ENVIRONMENT_PRESSURE_THRESHOLDS,
) {
    if (freeBytes < thresholds.diskBlockFreeBytes) return "failure";
    if (freeBytes < thresholds.diskWarnFreeBytes) return "warning";
    return "info";
}

/**
 * @param {{ freeBytes: number, totalBytes: number }} memory
 * @param {EnvironmentPressureThresholds} [thresholds]
 * @returns {EnvironmentPressureSeverity}
 */
export function classifyMemoryPressure(
    memory,
    thresholds = DEFAULT_ENVIRONMENT_PRESSURE_THRESHOLDS,
) {
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

/**
 * @param {Array<{ severity: EnvironmentPressureSeverity }>} signals
 * @returns {EnvironmentPressureDecision}
 */
export function decideEnvironmentPressure(signals) {
    if (signals.some((signal) => signal.severity === "failure")) {
        return "stop-and-investigate";
    }
    if (signals.some((signal) => signal.severity === "warning")) {
        return "safe-mode";
    }
    return "continue";
}

/**
 * @param {EnvironmentPressureOptions} [options]
 * @returns {EnvironmentPressureReport}
 */
export function buildEnvironmentPressureReport(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const thresholds = {
        ...DEFAULT_ENVIRONMENT_PRESSURE_THRESHOLDS,
        ...(options.thresholds ?? {}),
    };
    const env = options.env ?? process.env;
    const osApi = options.os ?? os;
    const fsApi = options.fs ?? fs;
    const now = options.now ?? new Date();
    const command = options.command ?? "environment-pressure";
    const operation = options.operation ?? "check";
    /** @type {Required<EnvironmentPressureGuidance>} */
    const guidance = {
        diskPressureAction:
            "Recover disk headroom before broad builds or test gates.",
        diskPressureCommand: null,
        diskProbeFailureAction:
            "Inspect filesystem pressure with the environment's disk diagnostic.",
        diskProbeFailureCommand: null,
        memoryPressureAction:
            "Use explicit test files, bounded workers, and package-scoped checks until memory pressure drops.",
        gitGcLogAction:
            "Inspect the Git maintenance marker; do not run prune or destructive Git cleanup without explicit operator intent.",
        ...(options.guidance ?? {}),
    };
    /** @type {EnvironmentPressureSignal[]} */
    const signals = [];

    try {
        const stats = fsApi.statfsSync(cwd);
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
            action: severity === "info" ? null : guidance.diskPressureAction,
            command: severity === "info" ? null : guidance.diskPressureCommand,
        });
    } catch (error) {
        signals.push({
            id: "filesystem-free-space",
            kind: "filesystem",
            severity: "warning",
            ok: true,
            path: cwd,
            summary: "Workspace filesystem free-space probe failed.",
            action: guidance.diskProbeFailureAction,
            command: guidance.diskProbeFailureCommand,
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
                : "Host memory is tight; broad worker fan-out can stall the environment.",
        action: memorySeverity === "info" ? null : guidance.memoryPressureAction,
    });

    const gitGcLogPath = path.join(cwd, ".git", "gc.log");
    if (fsApi.existsSync(gitGcLogPath)) {
        signals.push({
            id: "git-gc-log-present",
            kind: "git",
            severity: "warning",
            ok: true,
            path: gitGcLogPath,
            summary: "Git left a gc.log marker; automatic maintenance may be disabled until inspected.",
            action: guidance.gitGcLogAction,
        });
    }

    const cacheDir = env.CARGO_TARGET_DIR ? path.resolve(cwd, env.CARGO_TARGET_DIR) : null;
    if (cacheDir) {
        signals.push({
            id: "cargo-target-dir",
            kind: "cache",
            severity: "info",
            ok: true,
            path: cacheDir,
            summary: "Rust builds are routed through CARGO_TARGET_DIR.",
            action: null,
        });
    }

    const decision = decideEnvironmentPressure(signals);
    /** @type {EnvironmentPressureRecommendation[]} */
    const recommendations = signals
        .filter((signal) => signal.action)
        .map((signal) => ({
            diagnostic: `${command}:${signal.id}`,
            severity: signal.severity,
            summary: signal.summary,
            action: signal.action,
            command: signal.command ?? undefined,
            target: signal.path ?? signal.kind,
        }));
    const nextCommands = recommendations
        .map((recommendation) => recommendation.command)
        .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
    const nextActions = recommendations.map((recommendation) => recommendation.action);

    return {
        schemaVersion: 1,
        command,
        operation,
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
