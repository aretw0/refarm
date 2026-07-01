import { describe, expect, it } from "vitest";
import {
    declaredEnvironmentCeilingsFromConfig,
    parseEnvironmentCeilingEnforcementMode,
    parseEnvironmentCeilingScope,
    parseEnvironmentCeilingSliceKind,
    parseEnvironmentCeilingStatus,
} from "./environment-ceilings.js";

describe("environment ceiling declarations", () => {
    it("normalizes ADR-078 style environment ceilings as policy intent", () => {
        expect(declaredEnvironmentCeilingsFromConfig({
            environmentCeilings: {
                schemaVersion: 1,
                status: "declared-only",
                source: "ADR-078",
                scope: "local-devcontainer",
                enforcement: "planned-cgroup-v2",
                cgroupVersion: 2,
                slices: {
                    control: {
                        purpose: "Keep agent and refarm controllers responsive.",
                        pidsMax: 256,
                        memoryMinMiB: 1024,
                        memoryHighMiB: 2048,
                        memoryMaxMiB: 3072,
                        cpuWeight: 100,
                        oomScoreAdj: -500,
                    },
                    workload: {
                        pidsMax: 768,
                        memoryHighMiB: 4096,
                        memoryMaxMiB: 5632,
                        cpuWeight: 200,
                        oomScoreAdj: 500,
                    },
                    ignored: null,
                },
                heavyLanes: {
                    strictPressureGate: true,
                    serializedLock: ".refarm/locks/heavy-lane.lock",
                    maxConcurrency: 1,
                    workClasses: [" package-check ", "broad-check", ""],
                },
            },
        })).toEqual({
            schemaVersion: 1,
            status: "declared-only",
            source: "ADR-078",
            scope: "local-devcontainer",
            enforcement: "planned-cgroup-v2",
            cgroupVersion: 2,
            slices: {
                control: {
                    kind: "control",
                    purpose: "Keep agent and refarm controllers responsive.",
                    pidsMax: 256,
                    memoryMinMiB: 1024,
                    memoryHighMiB: 2048,
                    memoryMaxMiB: 3072,
                    cpuWeight: 100,
                    oomScoreAdj: -500,
                },
                workload: {
                    kind: "workload",
                    purpose: null,
                    pidsMax: 768,
                    memoryMinMiB: null,
                    memoryHighMiB: 4096,
                    memoryMaxMiB: 5632,
                    cpuWeight: 200,
                    oomScoreAdj: 500,
                },
            },
            heavyLanes: {
                strictPressureGate: true,
                serializedLock: ".refarm/locks/heavy-lane.lock",
                maxConcurrency: 1,
                workClasses: ["package-check", "broad-check"],
            },
        });
    });

    it("returns null when the repo has no environment ceiling declaration", () => {
        expect(declaredEnvironmentCeilingsFromConfig({})).toBeNull();
    });

    it("parses known enum values", () => {
        expect(parseEnvironmentCeilingStatus("enforced")).toBe("enforced");
        expect(parseEnvironmentCeilingStatus("unknown")).toBeNull();
        expect(parseEnvironmentCeilingScope("remote-node")).toBe("remote-node");
        expect(parseEnvironmentCeilingScope("machine")).toBeNull();
        expect(parseEnvironmentCeilingEnforcementMode("cgroup-v2")).toBe("cgroup-v2");
        expect(parseEnvironmentCeilingEnforcementMode("systemd")).toBeNull();
        expect(parseEnvironmentCeilingSliceKind("workload")).toBe("workload");
        expect(parseEnvironmentCeilingSliceKind("queue")).toBeNull();
    });
});
