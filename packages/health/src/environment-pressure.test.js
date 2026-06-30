import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    buildEnvironmentPressureReport,
    buildSessionPressureBudget,
    classifyDiskPressure,
    classifyMemoryPressure,
    decideEnvironmentPressure,
    planEnvironmentWorkCeiling,
} from "./environment-pressure.js";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

describe("environment pressure", () => {
    it("keeps the primitive source product-neutral", () => {
        const source = readFileSync(new URL("./environment-pressure.js", import.meta.url), "utf8");

        expect(source).not.toMatch(/\brefarm\b/i);
        expect(source).not.toMatch(/\bfactory\b/i);
    });

    it("classifies pressure without knowing the host application", () => {
        expect(classifyDiskPressure(2 * GiB)).toBe("failure");
        expect(classifyMemoryPressure({ freeBytes: 900 * MiB, totalBytes: 8 * GiB })).toBe("warning");
        expect(decideEnvironmentPressure([{ severity: "warning" }])).toBe("safe-mode");
        expect(decideEnvironmentPressure([{ severity: "failure" }])).toBe("stop-and-investigate");
    });

    it("classifies oversized session files without scanning the workspace", () => {
        const budget = buildSessionPressureBudget([
            { path: "small.jsonl", bytes: 1 * MiB },
            { path: "warn.jsonl", bytes: 60 * MiB },
            { path: "block.jsonl", bytes: 160 * MiB },
        ]);

        expect(budget.oversized.map((file) => file.level)).toEqual([
            "warning",
            "failure",
        ]);
        expect(budget.blockers.map((file) => file.path)).toEqual(["block.jsonl"]);
        expect(budget.recommendation).toBe("do-not-resume-archive-or-delete-after-checkpoint");
    });

    it("builds a configurable read-only report", () => {
        const report = buildEnvironmentPressureReport({
            cwd: "/repo",
            command: "factory-pressure",
            env: { CARGO_TARGET_DIR: ".cache/cargo-target" },
            now: new Date("2026-06-28T00:00:00.000Z"),
            fs: {
                existsSync: (candidate) => candidate === "/repo/.git/gc.log",
                statfsSync: () => ({
                    bavail: 2 * 1024,
                    bsize: 1024 * 1024,
                    blocks: 100 * 1024,
                }),
            },
            os: {
                freemem: () => 4 * GiB,
                totalmem: () => 8 * GiB,
            },
            guidance: {
                diskPressureAction: "Run the bounded disk diagnostic.",
                diskPressureCommand: "pnpm run clean:rust:check",
            },
        });

        expect(report).toEqual(expect.objectContaining({
            schemaVersion: 1,
            command: "factory-pressure",
            operation: "check",
            ok: false,
            decision: "stop-and-investigate",
            nextCommand: "pnpm run clean:rust:check",
        }));
        expect(report.signals.map((signal) => signal.id)).toEqual([
            "filesystem-free-space",
            "host-memory-available",
            "git-gc-log-present",
            "cargo-target-dir",
        ]);
        expect(report.recommendations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                diagnostic: "factory-pressure:filesystem-free-space",
                action: "Run the bounded disk diagnostic.",
            }),
        ]));
    });

    it("treats huge session pressure as advisory unless resume is requested", () => {
        const baseOptions = {
            cwd: "/repo",
            now: new Date("2026-06-29T00:00:00.000Z"),
            fs: {
                existsSync: () => false,
                statfsSync: () => ({
                    bavail: 100 * 1024,
                    bsize: 1024 * 1024,
                    blocks: 200 * 1024,
                }),
            },
            os: {
                freemem: () => 4 * GiB,
                totalmem: () => 8 * GiB,
            },
            sessionFiles: [
                { path: ".sessions/huge.jsonl", bytes: 160 * MiB },
            ],
        };

        const newSessionReport = buildEnvironmentPressureReport(baseOptions);
        const resumeReport = buildEnvironmentPressureReport({
            ...baseOptions,
            sessionResumeIntent: true,
        });

        expect(newSessionReport).toEqual(expect.objectContaining({
            ok: true,
            decision: "safe-mode",
        }));
        expect(newSessionReport.signals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: "large-session-file",
                kind: "session",
                severity: "warning",
                ok: true,
            }),
        ]));
        expect(resumeReport).toEqual(expect.objectContaining({
            ok: false,
            decision: "stop-and-investigate",
        }));
        expect(resumeReport.signals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: "huge-resume-session",
                kind: "session",
                severity: "failure",
                ok: false,
            }),
        ]));
    });

    it("allows focused checks under safe mode", () => {
        const report = buildEnvironmentPressureReport({
            cwd: "/repo",
            now: new Date("2026-06-30T00:00:00.000Z"),
            thresholds: {
                memoryWarnFreeBytes: 6 * GiB,
            },
            fs: {
                existsSync: () => false,
                statfsSync: () => ({
                    bavail: 100 * 1024,
                    bsize: 1024 * 1024,
                    blocks: 200 * 1024,
                }),
            },
            os: {
                freemem: () => 4 * GiB,
                totalmem: () => 8 * GiB,
            },
        });

        const plan = planEnvironmentWorkCeiling(report, {
            workClass: "package-check",
            command: "pnpm --filter pkg run test",
        });

        expect(report.decision).toBe("safe-mode");
        expect(plan).toEqual(expect.objectContaining({
            schemaVersion: 1,
            ok: true,
            decision: "allow",
            pressureDecision: "safe-mode",
            nextAction: null,
            nextCommand: null,
        }));
    });

    it("degrades broad checks to bounded fallbacks under safe mode", () => {
        const report = buildEnvironmentPressureReport({
            cwd: "/repo",
            now: new Date("2026-06-30T00:00:00.000Z"),
            thresholds: {
                memoryWarnFreeBytes: 6 * GiB,
            },
            fs: {
                existsSync: () => false,
                statfsSync: () => ({
                    bavail: 100 * 1024,
                    bsize: 1024 * 1024,
                    blocks: 200 * 1024,
                }),
            },
            os: {
                freemem: () => 4 * GiB,
                totalmem: () => 8 * GiB,
            },
        });

        const plan = planEnvironmentWorkCeiling(report, {
            workClass: "broad-check",
            command: "pnpm exec turbo run test",
            fallbackCommand: "pnpm --filter pkg run test",
        });

        expect(plan).toEqual(expect.objectContaining({
            ok: true,
            decision: "degrade",
            nextCommand: "pnpm --filter pkg run test",
        }));
        expect(plan.nextActions).toEqual(["Run the bounded fallback: pnpm --filter pkg run test"]);
    });

    it("refuses broad checks under safe mode when no fallback is available", () => {
        const report = buildEnvironmentPressureReport({
            cwd: "/repo",
            now: new Date("2026-06-30T00:00:00.000Z"),
            thresholds: {
                memoryWarnFreeBytes: 6 * GiB,
            },
            fs: {
                existsSync: () => false,
                statfsSync: () => ({
                    bavail: 100 * 1024,
                    bsize: 1024 * 1024,
                    blocks: 200 * 1024,
                }),
            },
            os: {
                freemem: () => 4 * GiB,
                totalmem: () => 8 * GiB,
            },
        });

        const plan = planEnvironmentWorkCeiling(report, {
            workClass: "broad-check",
            command: "pnpm exec turbo run test",
        });

        expect(plan).toEqual(expect.objectContaining({
            ok: false,
            decision: "refuse",
            nextAction: "Choose a focused check or provide a bounded fallback command.",
            nextCommand: null,
        }));
    });

    it("serializes fan-out under safe mode", () => {
        const report = buildEnvironmentPressureReport({
            cwd: "/repo",
            now: new Date("2026-06-30T00:00:00.000Z"),
            thresholds: {
                memoryWarnFreeBytes: 6 * GiB,
            },
            fs: {
                existsSync: () => false,
                statfsSync: () => ({
                    bavail: 100 * 1024,
                    bsize: 1024 * 1024,
                    blocks: 200 * 1024,
                }),
            },
            os: {
                freemem: () => 4 * GiB,
                totalmem: () => 8 * GiB,
            },
        });

        const plan = planEnvironmentWorkCeiling(report, {
            workClass: "worker-fanout",
            command: "run workers",
            maxConcurrency: 8,
        });

        expect(plan).toEqual(expect.objectContaining({
            ok: true,
            decision: "serialize",
            maxConcurrency: 1,
            nextAction: "Run `run workers` with concurrency 1.",
            nextCommand: "run workers",
        }));
    });

    it("refuses all work when pressure blocks the environment", () => {
        const report = buildEnvironmentPressureReport({
            cwd: "/repo",
            now: new Date("2026-06-30T00:00:00.000Z"),
            fs: {
                existsSync: () => false,
                statfsSync: () => ({
                    bavail: 2 * 1024,
                    bsize: 1024 * 1024,
                    blocks: 200 * 1024,
                }),
            },
            os: {
                freemem: () => 4 * GiB,
                totalmem: () => 8 * GiB,
            },
            guidance: {
                diskPressureAction: "Recover disk before work.",
                diskPressureCommand: "disk check",
            },
        });

        const plan = planEnvironmentWorkCeiling(report, {
            workClass: "focused-check",
            command: "node --test",
        });

        expect(report.decision).toBe("stop-and-investigate");
        expect(plan).toEqual(expect.objectContaining({
            ok: false,
            decision: "refuse",
            nextAction: "Recover disk before work.",
            nextCommand: "disk check",
        }));
        expect(plan.recommendations).toEqual(report.recommendations);
    });
});
