import path from "node:path";

export const WORKSPACE_NAMESPACE_PERSISTENCE = Object.freeze([
    "versioned",
    "ignored",
    "ephemeral",
]);

export const WORKSPACE_NAMESPACE_ACCESS = Object.freeze([
    "readOnly",
    "readWrite",
    "generated",
]);

export function parseWorkspaceNamespacePersistence(value) {
    return WORKSPACE_NAMESPACE_PERSISTENCE.includes(value) ? value : null;
}

export function parseWorkspaceNamespaceAccess(value) {
    return WORKSPACE_NAMESPACE_ACCESS.includes(value) ? value : null;
}

export function declaredWorkspaceNamespacesFromConfig(config, options = {}) {
    const baseDir = options.baseDir ?? process.cwd();
    const namespaces = config?.workspaceNamespaces;
    if (!namespaces || typeof namespaces !== "object" || Array.isArray(namespaces)) return [];

    return Object.entries(namespaces)
        .map(([id, value]) => normalizeDeclaredWorkspaceNamespace(id, value, baseDir))
        .filter(Boolean)
        .sort((left, right) => left.path.localeCompare(right.path));
}

export function declaredWorkspaceNamespaceFromConfig(config, namespacePath, options = {}) {
    const normalizedPath = normalizeNamespacePath(namespacePath);
    return declaredWorkspaceNamespacesFromConfig(config, options)
        .find((namespace) => namespace.path === normalizedPath) ?? null;
}

function normalizeDeclaredWorkspaceNamespace(id, value, baseDir) {
    if (!isRecord(value)) return null;

    const namespacePath = normalizeNamespacePath(
        typeof value.path === "string" && value.path.trim() ? value.path : id,
    );
    if (!namespacePath) return null;

    const owner = stringOrFallback(value.owner, "workspace");
    const purpose = stringOrFallback(value.purpose, "Declared workspace namespace.");
    const persistence = parseWorkspaceNamespacePersistence(value.persistence) ?? "ephemeral";
    const access = parseWorkspaceNamespaceAccess(value.access) ?? "readWrite";

    return {
        id,
        path: namespacePath,
        absolutePath: path.resolve(baseDir, namespacePath),
        owner,
        purpose,
        persistence,
        access,
    };
}

function normalizeNamespacePath(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
    if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
    if (!trimmed.startsWith(".")) return null;
    return trimmed;
}

function stringOrFallback(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
