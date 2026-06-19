import path from "node:path";

export const WORKSPACE_EXECUTION_ADAPTERS = Object.freeze([
    "auto",
    "turbo",
    "direct-script",
]);

export const WORKSPACE_KINDS = Object.freeze([
    "refarm",
    "consumer",
    "lab",
    "vault",
    "project",
]);

export const WORKSPACE_REMOTE_CACHE_PROVIDERS = Object.freeze([
    "cloudflare-turbo",
    "turbo",
    "custom",
]);

export function parseWorkspaceExecutionAdapter(value) {
    return WORKSPACE_EXECUTION_ADAPTERS.includes(value) ? value : null;
}

export function parseWorkspaceKind(value) {
    return WORKSPACE_KINDS.includes(value) ? value : null;
}

export function parseWorkspaceRemoteCacheProvider(value) {
    return WORKSPACE_REMOTE_CACHE_PROVIDERS.includes(value) ? value : null;
}

export function declaredWorkspacesFromConfig(config, options = {}) {
    const baseDir = options.baseDir ?? process.cwd();
    const workspaces = config?.workspaces;
    if (!workspaces || typeof workspaces !== "object" || Array.isArray(workspaces)) return [];

    return Object.entries(workspaces)
        .map(([id, value]) => normalizeDeclaredWorkspace(id, value, baseDir))
        .filter(Boolean)
        .sort((left, right) => left.id.localeCompare(right.id));
}

export function declaredWorkspaceFromConfig(config, workspaceId, options = {}) {
    return declaredWorkspacesFromConfig(config, options).find((workspace) => workspace.id === workspaceId) ?? null;
}

function normalizeDeclaredWorkspace(id, value, baseDir) {
    if (!isRecord(value)) return null;

    const workspacePath = typeof value.path === "string" && value.path.trim()
        ? value.path.trim()
        : ".";
    const kind = parseWorkspaceKind(value.kind) ?? "project";
    const execution = normalizeWorkspaceExecution(value.execution);
    const cache = normalizeWorkspaceCache(value.cache ?? value.execution?.cache);
    const bridges = normalizeWorkspaceBridges(value.bridges);

    return {
        id,
        path: workspacePath,
        absolutePath: path.resolve(baseDir, workspacePath),
        kind,
        execution,
        cache,
        bridges,
    };
}

function normalizeWorkspaceExecution(value) {
    const execution = isRecord(value) ? value : {};
    return {
        preferredAdapter: parseWorkspaceExecutionAdapter(execution.preferredAdapter) ?? "auto",
    };
}

function normalizeWorkspaceCache(value) {
    const cache = isRecord(value) ? value : {};
    const remote = isRecord(cache.remote) ? cache.remote : {};
    const remoteProvider = parseWorkspaceRemoteCacheProvider(remote.provider);
    return {
        local: cache.local === undefined ? true : Boolean(cache.local),
        remote: remoteProvider ? {
            provider: remoteProvider,
            env: normalizeWorkspaceRemoteCacheEnv(remote.env),
        } : null,
    };
}

function normalizeWorkspaceRemoteCacheEnv(value) {
    const env = isRecord(value) ? value : {};
    return {
        apiUrl: typeof env.apiUrl === "string" && env.apiUrl.trim()
            ? env.apiUrl.trim()
            : "TURBO_CACHE_API_URL",
        token: typeof env.token === "string" && env.token.trim()
            ? env.token.trim()
            : "TURBO_CACHE_TOKEN",
    };
}

function normalizeWorkspaceBridges(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isRecord)
        .map((bridge) => ({
            id: typeof bridge.id === "string" && bridge.id.trim() ? bridge.id.trim() : "default",
            kind: typeof bridge.kind === "string" && bridge.kind.trim() ? bridge.kind.trim() : "filesystem",
            path: typeof bridge.path === "string" && bridge.path.trim() ? bridge.path.trim() : null,
            hostPath: typeof bridge.hostPath === "string" && bridge.hostPath.trim() ? bridge.hostPath.trim() : null,
            mountHint: typeof bridge.mountHint === "string" && bridge.mountHint.trim() ? bridge.mountHint.trim() : null,
        }));
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
