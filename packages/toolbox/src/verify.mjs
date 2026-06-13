import { execSync } from 'node:child_process';
import { packageScriptCommand } from './package-manager.mjs';

function runCheck(name, command) {
    console.log(`\n⏳ Running ${name}...`);
    try {
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ ${name} passed!`);
        return true;
    } catch (error) {
        console.error(`❌ ${name} failed!`);
        return false;
    }
}

async function main() {
    console.log("🚜 Refarm Developer Toolbox: Quality Gates\n");

    const branchName = execSync("git rev-parse --abbrev-ref HEAD", { encoding: 'utf8' }).trim();
    const isHotfix = branchName.startsWith('hotfix/');

    if (isHotfix) {
        console.log("🔥 Hotfix branch detected! Ensuring critical tests pass...");
    } else {
        console.log("🌱 Feature branch detected. Running full verification suite.");
    }

    const checks = [
        { name: "Linter", command: packageScriptCommand("lint").command },
        { name: "Type Checker", command: packageScriptCommand("type-check").command },
        { name: "Unit Tests", command: packageScriptCommand("test:unit").command },
        { name: "Integration Tests", command: packageScriptCommand("test:integration").command }
        // E2E and Benchmarks can be added to the array as the suite expands
    ];

    let allPassed = true;
    for (const check of checks) {
        const passed = runCheck(check.name, check.command);
        if (!passed) allPassed = false;
    }

    console.log("\n=================================");
    if (allPassed) {
        console.log("🎉 All Quality Gates Passed! You are cleared for takeoff.");
        process.exit(0);
    } else {
        console.error("🛑 VERIFICATION FAILED. Please fix the errors above before finishing the task.");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
