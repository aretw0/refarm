import fs from "node:fs";
import path from "node:path";

const DEFAULT_WORKSPACE_ROOTS = ["packages", "apps"];
const REFARM_EXEMPT_PACKAGE_IDS = ["packages/deps", "packages/heartwood", "packages/tsconfig"];

/**
 * ProjectAuditor: workspace/package auditor with caller-provided policy.
 * It has no Refarm-only exemptions unless a preset or policy supplies them.
 */
export class ProjectAuditor {
    #title;
    #workspaceRoots;
    #exemptPackageIds;

    constructor(options = {}) {
        this.#title = options.title || "Workspace Health";
        this.#workspaceRoots = options.workspaceRoots || DEFAULT_WORKSPACE_ROOTS;
        this.#exemptPackageIds = new Set(options.exemptPackageIds || []);
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

        // In a stratified flow, we might receive results from generic_fs
        const genericResults = context.generic_fs || {};

        return {
            git: genericResults.git || [],
            builds: await this.checkBuildConfigs(rootDir, { workspaceRoots, exemptPackageIds }),
            alignment: await this.checkPackageAlignment(rootDir, { workspaceRoots, exemptPackageIds })
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
