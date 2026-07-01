import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DEFAULT_WORKSPACE_ROOTS = ["packages", "apps"];
const REFARM_EXEMPT_PACKAGE_IDS = ["packages/deps", "packages/heartwood", "packages/tsconfig"];
const PROJECT_AUTOMATIONS_RELATIVE_PATH = ".project/automations.json";
const PROJECT_AUTOMATION_STATUSES = new Set(["draft", "ready", "active", "archived"]);
const PROJECT_AUTOMATION_TRIGGER_TYPES = new Set(["manual", "cron", "once", "event"]);
const BUILTIN_INFRASTRUCTURE_NAMESPACES = new Set([
    ".cargo",
    ".changeset",
    ".devcontainer",
    ".git",
    ".github",
    ".refarm",
]);

/**
 * ProjectAuditor: workspace/package auditor with caller-provided policy.
 * It has no Refarm-only exemptions unless a preset or policy supplies them.
 */
export class ProjectAuditor {
    #title;
    #workspaceRoots;
    #exemptPackageIds;
    #workspaceNamespaces;

    constructor(options = {}) {
        this.#title = options.title || "Workspace Health";
        this.#workspaceRoots = options.workspaceRoots || DEFAULT_WORKSPACE_ROOTS;
        this.#exemptPackageIds = new Set(options.exemptPackageIds || []);
        this.#workspaceNamespaces = options.workspaceNamespaces || [];
    }

    get id() { return "project"; }
    get title() { return this.#title; }

    workspacePackageDirs(rootDir, options = {}) {
        const roots = options.workspaceRoots || this.#workspaceRoots;
        const entries = [];

        for (const workspaceRoot of roots) {
            const workspaceDir = path.resolve(rootDir, workspaceRoot);
            if (!fs.existsSync(workspaceDir)) continue;

            for (const name of fs.readdirSync(workspaceDir).sort()) {
                const packagePath = path.join(workspaceDir, name);
                if (!fs.statSync(packagePath).isDirectory()) continue;
                if (!fs.existsSync(path.join(packagePath, "package.json"))) continue;

                entries.push({
                    id: `${workspaceRoot}/${name}`,
                    name,
                    path: packagePath,
                    root: workspaceRoot,
                });
            }
        }

        return entries;
    }

    async audit(context = {}) {
        const rootDir = context.rootDir || process.cwd();
        const workspaceRoots = context.policy?.workspaceRoots || context.workspaceRoots;
        const exemptPackageIds = context.policy?.exemptPackageIds || context.exemptPackageIds;
        const workspaceNamespaces = context.policy?.workspaceNamespaces || context.workspaceNamespaces;

        // In a stratified flow, we might receive results from generic_fs
        const genericResults = context.generic_fs || {};

        return {
            git: genericResults.git || [],
            builds: await this.checkBuildConfigs(rootDir, { workspaceRoots, exemptPackageIds }),
            alignment: await this.checkPackageAlignment(rootDir, { workspaceRoots, exemptPackageIds }),
            automations: this.checkProjectAutomations(rootDir),
            namespaceWarnings: this.checkWorkspaceNamespaces(rootDir, { workspaceNamespaces }),
        };
    }

    isExemptPackage(pkg, options = {}) {
        const exemptPackageIds = new Set(options.exemptPackageIds || this.#exemptPackageIds);
        return exemptPackageIds.has(pkg.id);
    }

    /**
     * Returns true for packages that are not TypeScript packages requiring a build step.
     * Rust/WASM packages, JS-only packages, and placeholder packages are all exempt.
     */
    isNonTsPackage(pkgPath) {
        // Rust/WASM: any package with Cargo.toml is Rust, not TypeScript
        if (fs.existsSync(path.join(pkgPath, "Cargo.toml"))) return true;

        // Placeholder: no package.json and no tsconfig.json
        if (!fs.existsSync(path.join(pkgPath, "package.json")) &&
            !fs.existsSync(path.join(pkgPath, "tsconfig.json"))) return true;

        const pkgJsonPath = path.join(pkgPath, "package.json");
        if (fs.existsSync(pkgJsonPath)) {
            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
            const main = pkgJson.main || "";
            // JS-only: main in src/ with a .js/.mjs/.cjs extension — src IS the distribution
            if (/\.(js|mjs|cjs)$/.test(main) && main.includes("src/")) return true;
            // Types-only TypeScript: main points directly to a .ts file (no emit step)
            if (/\.ts$/.test(main)) return true;
        }

        return false;
    }

    /**
     * Ensures all TypeScript packages have a valid tsconfig.build.json.
     */
    async checkBuildConfigs(rootDir, options = {}) {
        const issues = [];
        for (const pkg of this.workspacePackageDirs(rootDir, options)) {
            if (this.isExemptPackage(pkg, options)) continue;

            // Skip non-TypeScript packages
            if (this.isNonTsPackage(pkg.path)) continue;

            const buildTsConfig = path.join(pkg.path, "tsconfig.build.json");
            if (!fs.existsSync(buildTsConfig)) {
                issues.push({ package: pkg.id, type: "missing_build_config" });
            }
        }
        return issues;
    }

    /**
     * Verifies if TypeScript package entry points point to dist/.
     */
    async checkPackageAlignment(rootDir, options = {}) {
        const issues = [];
        const status = await this.checkResolutionStatus(rootDir, options);

        for (const item of status) {
            if (item.mode === "LOCAL (src)") {
                issues.push({
                    package: item.package,
                    entry: "src/",
                    type: "local_alignment"
                });
            }
        }
        return issues;
    }

    /**
     * Reports resolution status for TypeScript packages (LOCAL vs PUBLISHED).
     * JS-only packages report as PUBLISHED since src IS their distribution.
     */
    async checkResolutionStatus(rootDir, options = {}) {
        const status = [];
        for (const pkg of this.workspacePackageDirs(rootDir, options)) {
            const pkgJsonPath = path.join(pkg.path, "package.json");

            if (this.isExemptPackage(pkg, options)) {
                status.push({ package: pkg.id, mode: "LINKED (dist)" });
                continue;
            }

            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
            const main = pkgJson.main || "";
            const exportsStr = JSON.stringify(pkgJson.exports || {});

            // JS-only packages: main in src/ with a .js extension — src IS the distribution
            if (/\.(js|mjs|cjs)$/.test(main) && main.includes("src/")) {
                status.push({ package: pkg.id, mode: "LINKED (js)" });
                continue;
            }
            // Types-only TypeScript: exposes .ts source directly, no build step
            if (/\.ts$/.test(main)) {
                status.push({ package: pkg.id, mode: "LINKED (types)" });
                continue;
            }

            const isDist = main.includes("dist") || exportsStr.includes("dist/");
            const isSrc = main.includes("src") || exportsStr.includes("src/");

            let mode = "LINKED (dist)";
            if (isSrc && !isDist) {
                mode = "LOCAL (src)";
            }

            status.push({ package: pkg.id, mode });
        }
        return status;
    }

    /**
     * Validates the optional project-local automation manifest read by operator handoffs.
     */
    checkProjectAutomations(rootDir) {
        const relativePath = PROJECT_AUTOMATIONS_RELATIVE_PATH;
        const automationsPath = path.join(rootDir, relativePath);
        if (!fs.existsSync(automationsPath)) return [];

        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(automationsPath, "utf-8"));
        } catch {
            return [projectAutomationIssue(relativePath, "invalid_project_automations_json", "Project automations must be valid JSON.")];
        }

        const records = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object"
                ? parsed.automations
                : undefined;
        if (!Array.isArray(records)) {
            return [projectAutomationIssue(relativePath, "invalid_project_automations_shape", "Project automations must be an array or an object with an automations array.")];
        }

        return records.flatMap((record, index) =>
            validateProjectAutomationRecord(record, relativePath, index)
        );
    }

    /**
     * Warns when versioned root dot-directories are not declared as workspace namespaces.
     * This keeps project/tool sidecars intentional without scanning ignored runtime caches.
     */
    checkWorkspaceNamespaces(rootDir, options = {}) {
        const declarations = options.workspaceNamespaces || this.#workspaceNamespaces;
        const declaredPaths = new Set(
            declarations
                .map((namespace) => normalizeNamespacePath(namespace?.path))
                .filter(Boolean),
        );
        const warnings = [];

        for (const namespacePath of versionedRootDotDirectories(rootDir)) {
            if (BUILTIN_INFRASTRUCTURE_NAMESPACES.has(namespacePath)) continue;
            if (declaredPaths.has(namespacePath)) continue;
            warnings.push(workspaceNamespaceIssue(
                namespacePath,
                "undeclared_workspace_namespace",
                "Versioned root namespace must be declared in workspaceNamespaces.",
            ));
        }

        return warnings;
    }
}

function projectAutomationIssue(file, type, note, suffix = "") {
    return {
        file,
        type,
        category: "project-state",
        note: suffix ? `${note} (${suffix})` : note,
    };
}

function validateProjectAutomationRecord(record, file, index) {
    const suffix = `automations[${index}]`;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        return [projectAutomationIssue(file, "invalid_project_automation_record", "Project automation entries must be objects.", suffix)];
    }

    const issues = [];
    if (typeof record.id !== "string" || record.id.trim().length === 0) {
        issues.push(projectAutomationIssue(file, "invalid_project_automation_id", "Project automation id must be a non-empty string.", suffix));
    }
    if (typeof record.name !== "string" || record.name.trim().length === 0) {
        issues.push(projectAutomationIssue(file, "invalid_project_automation_name", "Project automation name must be a non-empty string.", suffix));
    }
    if (
        record.status !== undefined &&
        (typeof record.status !== "string" || !PROJECT_AUTOMATION_STATUSES.has(record.status))
    ) {
        issues.push(projectAutomationIssue(file, "invalid_project_automation_status", "Project automation status must be draft, ready, active, or archived.", suffix));
    }
    if (!Array.isArray(record.triggers) || record.triggers.length === 0) {
        issues.push(projectAutomationIssue(file, "invalid_project_automation_triggers", "Project automation triggers must be a non-empty array.", suffix));
        return issues;
    }

    record.triggers.forEach((trigger, triggerIndex) => {
        issues.push(...validateProjectAutomationTrigger(trigger, file, `${suffix}.triggers[${triggerIndex}]`));
    });
    return issues;
}

function validateProjectAutomationTrigger(trigger, file, suffix) {
    if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) {
        return [projectAutomationIssue(file, "invalid_project_automation_trigger", "Project automation triggers must be objects.", suffix)];
    }
    if (typeof trigger.type !== "string" || !PROJECT_AUTOMATION_TRIGGER_TYPES.has(trigger.type)) {
        return [projectAutomationIssue(file, "invalid_project_automation_trigger_type", "Project automation trigger type must be manual, cron, once, or event.", suffix)];
    }
    if (
        trigger.type === "once" &&
        (typeof trigger.at !== "string" || Number.isNaN(new Date(trigger.at).getTime()))
    ) {
        return [projectAutomationIssue(file, "invalid_project_automation_once_trigger", "Project automation once trigger requires a valid at timestamp.", suffix)];
    }
    if (trigger.type === "cron" && (typeof trigger.schedule !== "string" || trigger.schedule.trim().length === 0)) {
        return [projectAutomationIssue(file, "invalid_project_automation_cron_trigger", "Project automation cron trigger requires a non-empty schedule.", suffix)];
    }
    if (trigger.type === "event" && (typeof trigger.eventType !== "string" || trigger.eventType.trim().length === 0)) {
        return [projectAutomationIssue(file, "invalid_project_automation_event_trigger", "Project automation event trigger requires a non-empty eventType.", suffix)];
    }
    return [];
}

function workspaceNamespaceIssue(namespacePath, type, note) {
    return {
        path: namespacePath,
        type,
        category: "workspace-namespace",
        note,
    };
}

function versionedRootDotDirectories(rootDir) {
    let raw;
    try {
        raw = execFileSync("git", ["ls-files", "-z"], {
            cwd: rootDir,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        });
    } catch {
        return [];
    }

    const namespaces = new Set();
    for (const filePath of raw.split("\0")) {
        if (!filePath) continue;
        const [rootEntry] = filePath.split("/");
        const namespacePath = normalizeNamespacePath(rootEntry);
        if (!namespacePath || !namespacePath.startsWith(".")) continue;
        try {
            if (!fs.statSync(path.join(rootDir, namespacePath)).isDirectory()) continue;
        } catch {
            continue;
        }
        namespaces.add(namespacePath);
    }
    return [...namespaces].sort();
}

function normalizeNamespacePath(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
    if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.includes("..")) return null;
    return normalized;
}

/**
 * RefarmProjectAuditor: Refarm's configured project-health policy.
 * Kept as a convenience preset for apps/refarm; the base auditor remains agnostic.
 */
export class RefarmProjectAuditor extends ProjectAuditor {
    constructor(options = {}) {
        super({
            title: "Refarm Monorepo Health",
            workspaceRoots: DEFAULT_WORKSPACE_ROOTS,
            exemptPackageIds: REFARM_EXEMPT_PACKAGE_IDS,
            ...options,
        });
    }
}
