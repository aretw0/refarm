import { loadConfig } from "@refarm.dev/config";
import { WindmillEngine } from "@refarm.dev/windmill";

/**
 * CLI Entry point for Windmill Infrastructure Sync
 * Usage: node scripts/ci/sync-infra.mjs [--dry-run]
 */
async function main() {
    const isDryRun = process.argv.includes("--dry-run");
    const config = loadConfig();

    if (!config.brand) {
        console.error("❌ Failed to load Refarm configuration (brand missing).");
        console.log("Config loaded:", JSON.stringify(config, null, 2));
        process.exit(1);
    }

    const windmill = new WindmillEngine(config, {
        dryRun: isDryRun,
        verbose: true
    });

    try {
        const results = await windmill.sync();
        
        if (isDryRun) {
            console.log("\n🧪 Dry Run finished. Review the changes above.");
        } else {
            console.log("\n✨ Infrastructure reconciliation complete.");
        }
    } catch (err) {
        console.error("\n💥 Windmill crashed during sync:");
        console.error(err);
        process.exit(1);
    }
}

main();
