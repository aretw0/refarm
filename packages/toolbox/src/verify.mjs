import { execSync } from 'node:child_process';

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

    const isHotfix = runCheck("Checking Branch", "git rev-parse --abbrev-ref HEAD | grep '^hotfix/' > /dev/null 2>&1");

    if (isHotfix) {
        console.log("🔥 Hotfix branch detected! Ensuring critical tests pass...");
    } else {
        console.log("🌱 Feature branch detected. Running full verification suite.");
    }

    const checks = [
        { name: "Linter", command: "npm run lint" },
        { name: "Type Checker", command: "npm run type-check" },
        { name: "Unit Tests", command: "npm run test:unit" },
        { name: "Integration Tests", command: "npm run test:integration" }
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
