import { existsSync, statSync } from "node:fs";
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
    const candidates = new Set();
    for (const changedPath of changedFilePathsFromGitStatus(status)) {
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
