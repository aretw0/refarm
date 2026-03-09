#!/usr/bin/env node
/**
 * GitHub Matrix Builder
 * 
 * Generates a test matrix for GitHub Actions based on changed packages.
 * This script detects which packages have been modified and creates a matrix
 * of forward and backward compatibility tests to run in parallel.
 * 
 * Output: Sets GITHUB_OUTPUT with the matrix JSON for use in workflows
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(__dirname, "../..");

/**
 * Identify packages that have changed compared to main branch
 */
function getChangedPackages() {
    try {
        // Use turbo's built-in dry-run to detect affected packages
        const output = execSync(
            "npx turbo run test --filter=...[origin/main] --dry-run=json",
            { cwd: ROOT_DIR, encoding: "utf-8" }
        );
        const turboData = JSON.parse(output);
        
        // Filter out the root package marker
        const packages = (turboData.packages || []).filter(pkg => pkg !== "//");
        
        console.log(`📦 Changed packages detected: ${packages.length}`);
        packages.forEach(pkg => console.log(`  - ${pkg}`));
        
        return packages;
    } catch (err) {
        console.warn("⚠️  Failed to detect changed packages, defaulting to empty matrix");
        console.error(err.message);
        return [];
    }
}

/**
 * Query all workspace packages and their dependencies
 */
function getAllWorkspacePackages() {
    try {
        const output = execSync("npm query .workspace", { 
            cwd: ROOT_DIR, 
            encoding: "utf-8" 
        });
        return JSON.parse(output);
    } catch (err) {
        console.error("❌ Failed to query workspace packages:", err.message);
        return [];
    }
}

/**
 * Build test matrix with forward and backward compatibility tests
 */
function buildMatrix(changedPackages) {
    const matrix = { include: [] };
    
    if (changedPackages.length === 0) {
        console.log("ℹ️  No changed packages detected, matrix will be empty");
        return matrix;
    }

    const allWorkspacePackages = getAllWorkspacePackages();
    
    for (const pkgName of changedPackages) {
        // Skip config/tooling packages that don't need matrix testing
        if (
            pkgName.includes("eslint") || 
            pkgName.includes("tsconfig") || 
            pkgName.includes("config")
        ) {
            console.log(`⏭️  Skipping tooling package: ${pkgName}`);
            continue;
        }

        // Forward compatibility test: test changed package against published deps
        matrix.include.push({
            strategy: "forward",
            package: pkgName,
            name: `Forward: ${pkgName} (local) with published deps`,
        });

        // Find packages that depend on this changed package
        const dependents = allWorkspacePackages.filter(p => {
            const allDeps = {
                ...(p.dependencies || {}),
                ...(p.devDependencies || {}),
            };
            return Object.keys(allDeps).includes(pkgName);
        });

        // Backward compatibility test: test published dependents with local changes
        for (const dependent of dependents) {
            matrix.include.push({
                strategy: "backward",
                package: pkgName,
                consumer: dependent.name,
                name: `Backward: published ${dependent.name} with local ${pkgName}`,
            });
        }
    }

    console.log(`\n✅ Matrix generated with ${matrix.include.length} test configurations:`);
    matrix.include.forEach((job, idx) => {
        console.log(`  ${idx + 1}. [${job.strategy}] ${job.name}`);
    });

    return matrix;
}

/**
 * Write matrix to GITHUB_OUTPUT for workflow consumption
 */
function writeToGitHubOutput(matrix) {
    const matrixJson = JSON.stringify(matrix);
    
    if (process.env.GITHUB_OUTPUT) {
        // GitHub Actions native output format
        const outputLine = `matrix=${matrixJson}\n`;
        writeFileSync(process.env.GITHUB_OUTPUT, outputLine, { flag: 'a' });
        console.log("\n✅ Matrix written to GITHUB_OUTPUT");
    } else {
        // Fallback for local testing
        console.log("\n📋 Matrix JSON (GITHUB_OUTPUT not set, showing output):");
        console.log(matrixJson);
    }
}

/**
 * Main execution
 */
function main() {
    console.log("🔍 GitHub Matrix Builder — Detecting changes and building test matrix\n");
    
    try {
        const changedPackages = getChangedPackages();
        const matrix = buildMatrix(changedPackages);
        writeToGitHubOutput(matrix);
        
        console.log("\n🎉 Matrix builder completed successfully");
        process.exit(0);
    } catch (err) {
        console.error("\n❌ Matrix builder failed:", err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { getChangedPackages, buildMatrix, writeToGitHubOutput };
