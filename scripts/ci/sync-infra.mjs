import { loadConfig } from "@refarm.dev/config";
import { GitHubProvider } from "./providers/github.mjs";
import { CloudflareProvider } from "./providers/cloudflare.mjs";

/**
 * Infrastructure Synchronizer
 * Reconciles the state of external providers with refarm.config.json
 */
async function sync() {
    console.log("--- Refarm Infrastructure Sync ---");
    
    const config = loadConfig();
    if (!config.brand) {
        console.error("Failed to load config. Make sure refarm.config.json exists.");
        process.exit(1);
    }

    const github = new GitHubProvider(config);
    const cloudflare = new CloudflareProvider(config);

    // 1. Sync DNS (if Cloudflare config exists)
    if (config.infrastructure?.cloudflare) {
        const records = [
            { type: "CNAME", name: config.brand.slug, content: `${config.brand.slug}.github.io` },
            // Add more records derived from config
        ];
        await cloudflare.updateDNS(records);
    }

    // 2. Audit Repositories (if GitHub config exists)
    if (config.infrastructure?.gitHost === "github") {
        const repos = await github.listRepos();
        console.log(`[sync] Found ${repos.length} repositories in organization.`);
    }

    console.log("--- Sync Complete ---");
}

sync().catch(err => {
    console.error(err);
    process.exit(1);
});
