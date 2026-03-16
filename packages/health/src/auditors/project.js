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
     * Ensures all packages have a valid tsconfig.build.json.
     * Specific to Refarm's TypeScript build strategy.
     */
    async checkBuildConfigs(rootDir) {
        const issues = [];
        const packagesDir = path.resolve(rootDir, "packages");
        if (!fs.existsSync(packagesDir)) return issues;

        const pkgs = fs.readdirSync(packagesDir);
        for (const pkg of pkgs) {
            const pkgPath = path.join(packagesDir, pkg);
            if (!fs.statSync(pkgPath).isDirectory()) continue;
            
            // heartwood (WASM) and tsconfig (meta) are exceptions
            if (pkg === "heartwood" || pkg === "tsconfig") continue;

            const buildTsConfig = path.join(pkgPath, "tsconfig.build.json");
            if (!fs.existsSync(buildTsConfig)) {
                issues.push({ package: pkg, type: "missing_build_config" });
            }
        }
        return issues;
    }

    /**
     * Verifies if package entry points point to dist/.
     * Specific to Refarm's distribution policy.
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
     * Reports resolution status (LOCAL vs PUBLISHED).
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
            if (fs.existsSync(pkgJsonPath)) {
                const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
                const main = pkgJson.main || "";
                const exportsStr = JSON.stringify(pkgJson.exports || {});
                
                const isDist = main.includes("dist") || exportsStr.includes("dist/");
                const isSrc = main.includes("src") || exportsStr.includes("src/");

                let mode = "PUBLISHED (dist)";
                if (isSrc && !isDist) {
                    mode = "LOCAL (src)";
                }
                
                if (pkg === "tsconfig" || pkg === "heartwood") {
                    status.push({ package: pkg, mode: "PUBLISHED (dist)" });
                    continue;
                }

                status.push({ package: pkg, mode });
            }
        }
        return status;
    }
}
