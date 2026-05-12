import fs from "node:fs";
import path from "node:path";

/**
 * RefarmProjectAuditor: Domain-specific auditor for Refarm monorepo rules.
 * Leverages generic auditors and Graph policies.
 */
export class RefarmProjectAuditor {
    get id() { return "project"; }
    get title() { return "Refarm Monorepo Health"; }

    async audit(context = {}) {
        const rootDir = context.rootDir || process.cwd();

        // In a stratified flow, we might receive results from generic_fs
        const genericResults = context.generic_fs || {};

        return {
            git: genericResults.git || [],
            builds: await this.checkBuildConfigs(rootDir),
            alignment: await this.checkPackageAlignment(rootDir)
        };
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
    async checkBuildConfigs(rootDir) {
        const issues = [];
        const packagesDir = path.resolve(rootDir, "packages");
        if (!fs.existsSync(packagesDir)) return issues;

        const pkgs = fs.readdirSync(packagesDir);
        for (const pkg of pkgs) {
            const pkgPath = path.join(packagesDir, pkg);
            if (!fs.statSync(pkgPath).isDirectory()) continue;

            // Hardcoded exceptions: heartwood (WASM with package.json), tsconfig (meta)
            if (pkg === "heartwood" || pkg === "tsconfig") continue;

            // Skip non-TypeScript packages
            if (this.isNonTsPackage(pkgPath)) continue;

            const buildTsConfig = path.join(pkgPath, "tsconfig.build.json");
            if (!fs.existsSync(buildTsConfig)) {
                issues.push({ package: pkg, type: "missing_build_config" });
            }
        }
        return issues;
    }

    /**
     * Verifies if TypeScript package entry points point to dist/.
     */
    async checkPackageAlignment(rootDir) {
        const issues = [];
        const status = await this.checkResolutionStatus(rootDir);

        for (const item of status) {
            if (item.package === "tsconfig") continue;
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
    async checkResolutionStatus(rootDir) {
        const status = [];
        const packagesDir = path.resolve(rootDir, "packages");
        if (!fs.existsSync(packagesDir)) return status;

        const pkgs = fs.readdirSync(packagesDir);
        for (const pkg of pkgs) {
            const pkgPath = path.join(packagesDir, pkg);
            if (!fs.statSync(pkgPath).isDirectory()) continue;

            const pkgJsonPath = path.join(pkgPath, "package.json");
            if (!fs.existsSync(pkgJsonPath)) continue;

            if (pkg === "tsconfig" || pkg === "heartwood") {
                status.push({ package: pkg, mode: "LINKED (dist)" });
                continue;
            }

            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
            const main = pkgJson.main || "";
            const exportsStr = JSON.stringify(pkgJson.exports || {});

            // JS-only packages: main in src/ with a .js extension — src IS the distribution
            if (/\.(js|mjs|cjs)$/.test(main) && main.includes("src/")) {
                status.push({ package: pkg, mode: "LINKED (js)" });
                continue;
            }
            // Types-only TypeScript: exposes .ts source directly, no build step
            if (/\.ts$/.test(main)) {
                status.push({ package: pkg, mode: "LINKED (types)" });
                continue;
            }

            const isDist = main.includes("dist") || exportsStr.includes("dist/");
            const isSrc = main.includes("src") || exportsStr.includes("src/");

            let mode = "LINKED (dist)";
            if (isSrc && !isDist) {
                mode = "LOCAL (src)";
            }

            status.push({ package: pkg, mode });
        }
        return status;
    }
}
