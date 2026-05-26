import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export function changedFilePathsFromGitStatus(status) {
    return String(status ?? "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
            const rawPath = line.slice(3).trim();
            const renamedPath = rawPath.includes(" -> ")
                ? rawPath.split(" -> ").at(-1)
                : rawPath;
            return unquoteGitPath(renamedPath ?? rawPath);
        })
        .filter(Boolean);
}

export function affectedWorkspacePackagesFromGitStatus(root, status, options = {}) {
    return affectedWorkspacePackagesFromChangedPaths(
        root,
        changedFilePathsFromGitStatus(status),
        options,
    );
}

export function changedFilePathsFromGitNameOnly(output) {
    return String(output ?? "")
        .split(/\r?\n/)
        .map((line) => unquoteGitPath(line.trimEnd()))
        .filter(Boolean);
}

export function affectedWorkspacePackagesFromChangedPaths(root, changedPaths, options = {}) {
    const candidates = new Set();
    for (const changedPath of changedPaths) {
        const workspace = findWorkspacePackageForPath(root, changedPath, options);
        if (workspace) candidates.add(workspace);
    }
    return [...candidates].sort();
}

export function findWorkspacePackageForPath(root, changedPath, options = {}) {
    const includeRoot = options.includeRoot === true;
    const absolutePath = path.resolve(root, changedPath);
    let current = existsSync(absolutePath) && statSync(absolutePath).isDirectory()
        ? absolutePath
        : path.dirname(absolutePath);
    const resolvedRoot = path.resolve(root);

    while (isInsideOrEqual(current, resolvedRoot)) {
        if (existsSync(path.join(current, "package.json"))) {
            const workspace = path.relative(resolvedRoot, current) || ".";
            return workspace === "." && !includeRoot ? null : workspace;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

export function findWorkspaceRoot(startDir = process.cwd()) {
    let current = path.resolve(startDir);
    while (true) {
        if (hasWorkspaceRootMarker(current)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) return path.resolve(startDir);
        current = parent;
    }
}

function hasWorkspaceRootMarker(dir) {
    return existsSync(path.join(dir, ".git")) ||
        existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
        packageJsonDeclaresWorkspaces(dir);
}

function packageJsonDeclaresWorkspaces(dir) {
    try {
        const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
        return Array.isArray(pkg.workspaces) ||
            (
                typeof pkg.workspaces === "object" &&
                pkg.workspaces !== null &&
                Array.isArray(pkg.workspaces.packages)
            );
    } catch {
        return false;
    }
}

function unquoteGitPath(value) {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch {
            return value.slice(1, -1);
        }
    }
    return value;
}

function isInsideOrEqual(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
