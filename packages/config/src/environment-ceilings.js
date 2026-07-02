export const ENVIRONMENT_CEILING_STATUSES = Object.freeze([
    "declared-only",
    "enforced",
    "disabled",
]);

export const ENVIRONMENT_CEILING_SCOPES = Object.freeze([
    "local-devcontainer",
    "remote-node",
    "workspace",
]);

export const ENVIRONMENT_CEILING_ENFORCEMENT_MODES = Object.freeze([
    "planned-cgroup-v2",
    "cgroup-v2",
    "advisory",
    "disabled",
]);

export const ENVIRONMENT_CEILING_SLICE_KINDS = Object.freeze([
    "control",
    "workload",
    "agent",
]);

export function parseEnvironmentCeilingStatus(value) {
    return ENVIRONMENT_CEILING_STATUSES.includes(value) ? value : null;
}

export function parseEnvironmentCeilingScope(value) {
    return ENVIRONMENT_CEILING_SCOPES.includes(value) ? value : null;
}

export function parseEnvironmentCeilingEnforcementMode(value) {
    return ENVIRONMENT_CEILING_ENFORCEMENT_MODES.includes(value) ? value : null;
}

export function parseEnvironmentCeilingSliceKind(value) {
    return ENVIRONMENT_CEILING_SLICE_KINDS.includes(value) ? value : null;
}

export function declaredEnvironmentCeilingsFromConfig(config) {
    const value = config?.environmentCeilings;
    if (!isRecord(value)) return null;

    const status = parseEnvironmentCeilingStatus(value.status) ?? "declared-only";
    const scope = parseEnvironmentCeilingScope(value.scope) ?? "workspace";
    const enforcement = parseEnvironmentCeilingEnforcementMode(value.enforcement) ?? "advisory";
    const slices = normalizeEnvironmentCeilingSlices(value.slices);

    return {
        schemaVersion: Number(value.schemaVersion) === 1 ? 1 : 1,
        status,
        source: stringOrNull(value.source),
        scope,
        enforcement,
        cgroupVersion: Number(value.cgroupVersion) === 2 ? 2 : null,
        slices,
        heavyLanes: normalizeHeavyLanePolicy(value.heavyLanes),
    };
}

function normalizeEnvironmentCeilingSlices(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .map(([id, slice]) => normalizeEnvironmentCeilingSlice(id, slice))
            .filter(Boolean),
    );
}

function normalizeEnvironmentCeilingSlice(id, value) {
    if (!isRecord(value)) return null;
    const kind = parseEnvironmentCeilingSliceKind(value.kind) ?? parseEnvironmentCeilingSliceKind(id);
    if (!kind) return null;

    return [id, {
        kind,
        purpose: stringOrNull(value.purpose),
        pidsMax: positiveIntegerOrNull(value.pidsMax),
        memoryMinMiB: positiveIntegerOrNull(value.memoryMinMiB),
        memoryHighMiB: positiveIntegerOrNull(value.memoryHighMiB),
        memoryMaxMiB: positiveIntegerOrNull(value.memoryMaxMiB),
        cpuWeight: positiveIntegerOrNull(value.cpuWeight),
        oomScoreAdj: integerOrNull(value.oomScoreAdj),
    }];
}

function normalizeHeavyLanePolicy(value) {
    const policy = isRecord(value) ? value : {};
    return {
        strictPressureGate: policy.strictPressureGate === undefined
            ? false
            : Boolean(policy.strictPressureGate),
        serializedLock: stringOrNull(policy.serializedLock),
        maxConcurrency: positiveIntegerOrNull(policy.maxConcurrency),
        workClasses: Array.isArray(policy.workClasses)
            ? policy.workClasses.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
            : [],
    };
}

function stringOrNull(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function integerOrNull(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
