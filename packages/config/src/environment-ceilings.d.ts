export type EnvironmentCeilingStatus = "declared-only" | "enforced" | "disabled";
export type EnvironmentCeilingScope = "local-devcontainer" | "remote-node" | "workspace";
export type EnvironmentCeilingEnforcementMode = "planned-cgroup-v2" | "cgroup-v2" | "advisory" | "disabled";
export type EnvironmentCeilingSliceKind = "control" | "workload" | "agent";

export interface DeclaredEnvironmentCeilingSlice {
    kind: EnvironmentCeilingSliceKind;
    purpose: string | null;
    pidsMax: number | null;
    memoryMinMiB: number | null;
    memoryHighMiB: number | null;
    memoryMaxMiB: number | null;
    cpuWeight: number | null;
    oomScoreAdj: number | null;
}

export interface DeclaredEnvironmentHeavyLanePolicy {
    strictPressureGate: boolean;
    serializedLock: string | null;
    maxConcurrency: number | null;
    workClasses: string[];
}

export interface DeclaredEnvironmentCeilingsConfig {
    schemaVersion: 1;
    status: EnvironmentCeilingStatus;
    source: string | null;
    scope: EnvironmentCeilingScope;
    enforcement: EnvironmentCeilingEnforcementMode;
    cgroupVersion: 2 | null;
    slices: Record<string, DeclaredEnvironmentCeilingSlice>;
    heavyLanes: DeclaredEnvironmentHeavyLanePolicy;
}

export const ENVIRONMENT_CEILING_STATUSES: readonly EnvironmentCeilingStatus[];
export const ENVIRONMENT_CEILING_SCOPES: readonly EnvironmentCeilingScope[];
export const ENVIRONMENT_CEILING_ENFORCEMENT_MODES: readonly EnvironmentCeilingEnforcementMode[];
export const ENVIRONMENT_CEILING_SLICE_KINDS: readonly EnvironmentCeilingSliceKind[];
export function parseEnvironmentCeilingStatus(value: unknown): EnvironmentCeilingStatus | null;
export function parseEnvironmentCeilingScope(value: unknown): EnvironmentCeilingScope | null;
export function parseEnvironmentCeilingEnforcementMode(value: unknown): EnvironmentCeilingEnforcementMode | null;
export function parseEnvironmentCeilingSliceKind(value: unknown): EnvironmentCeilingSliceKind | null;
export function declaredEnvironmentCeilingsFromConfig(config: unknown): DeclaredEnvironmentCeilingsConfig | null;
