import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * SovereignHealth: Reconstructed from signatures.
 * Audits monorepo for Git hygiene, builds, and alignment.
 */
export class SovereignHealth {
    /**
     * Runs all deterministic diagnostics.
     */
    async audit() {
        return {
            git: await this.checkGitIgnores(),
            builds: await this.checkBuildConfigs(),
            alignment: await this.checkPackageAlignment()
        };
    }

    /**
     * Helper to find files recursively.
     */
    _getAllFiles(dirPath, arrayOfFiles) {
        const files = fs.readdirSync(dirPath);
        arrayOfFiles = arrayOfFiles || [];

        files.forEach((file) => {
            if (fs.statSync(dirPath + "/" + file).isDirectory()) {
                if (file !== "node_modules" && file !== ".git" && file !== "dist") {
                    arrayOfFiles = this._getAllFiles(dirPath + "/" + file, arrayOfFiles);
                }
            } else {
                arrayOfFiles.push(path.join(dirPath, "/", file));
            }
        });

        return arrayOfFiles;
    }

    /**
     * Detects if source files are being incorrectly ignored by Git.
     */
    async checkGitIgnores() {
        const issues = [];
        try {
            const git = (await import("isomorphic-git")).default;
            const allFiles = this._getAllFiles(path.join(process.cwd(), "packages"));
            const srcFiles = allFiles.filter(f => (f.includes("/src/") && (f.endsWith(".ts") || f.endsWith(".js"))));

            for (const file of srcFiles) {
                const relativePath = path.relative(process.cwd(), file);
                const ignored = await git.isIgnored({
                    fs,
                    dir: process.cwd(),
                    filepath: relativePath
                });

                if (ignored) {
                    issues.push({ file: relativePath, type: "incorrectly_ignored" });
                }
            }
        } catch (e) {
            console.error(`[Health] Git ignore audit failed: ${e.message}`);
        }
        return issues;
    }


    /**
     * Ensures all packages have a valid tsconfig.build.json.
     */
    async checkBuildConfigs() {
        const issues = [];
        const packagesDir = path.resolve(process.cwd(), "packages");
        if (!fs.existsSync(packagesDir)) return issues;

        const pkgs = fs.readdirSync(packagesDir);
        for (const pkg of pkgs) {
            const pkgPath = path.join(packagesDir, pkg);
            if (!fs.statSync(pkgPath).isDirectory()) continue;
            
            const pkgJsonPath = path.join(pkgPath, "package.json");
            if (!fs.existsSync(pkgJsonPath)) continue;

            // heartwood is Rust/WASM, tsconfig is just configs
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
     */
    async checkPackageAlignment() {
        const issues = [];
        const status = await this.checkResolutionStatus();
        
        for (const item of status) {
            // tsconfig doesn't have a dist/ folder, it's just raw json
            if (item.package === "tsconfig") continue;

            if (item.mode === "LOCAL (src)") {
                issues.push({ package: item.package, entry: "src/", type: "local_alignment" });
            }
        }
        return issues;
    }

    /**
     * Reports resolution status (LOCAL vs PUBLISHED) for all packages.
     */
    async checkResolutionStatus() {
        const status = [];
        const packagesDir = path.resolve(process.cwd(), "packages");
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
                
                // If it's a special package that doesn't follow the pattern, we might want to skip or handle specially
                // But for now, let's just make it more robust.
                const isDist = main.includes("dist") || exportsStr.includes("dist/");
                const isSrc = main.includes("src") || exportsStr.includes("src/");

                let mode = "PUBLISHED (dist)";
                if (isSrc && !isDist) {
                    mode = "LOCAL (src)";
                } else if (!isSrc && !isDist) {
                    // Default to published if neither is found (e.g. tsconfig)
                    mode = "PUBLISHED (dist)";
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
