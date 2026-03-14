import { loadConfig } from "@refarm.dev/config";
import { writeFileSync } from "node:fs";

/**
 * Setup Environment for GitHub Actions
 * Exports configuration values to GITHUB_ENV
 */
function setup() {
    console.log("--- Setting up Refarm Environment ---");
    const config = loadConfig();
    
    const envs = {
        REFARM_BRAND_NAME: config.brand?.name,
        REFARM_BRAND_SLUG: config.brand?.slug,
        REFARM_BRAND_OWNER: config.brand?.owner,
        REFARM_GIT_HOST: config.infrastructure?.gitHost,
        REFARM_SITE_URL: config.brand?.urls?.site,
        REFARM_REPO_URL: config.brand?.urls?.repository,
    };

    // Dynamically export all scopes
    if (config.brand?.scopes) {
        for (const [key, value] of Object.entries(config.brand.scopes)) {
            envs[`REFARM_SCOPE_${key.toUpperCase()}`] = value;
        }
    }

    if (process.env.GITHUB_ENV) {
        let output = "";
        for (const [key, value] of Object.entries(envs)) {
            if (value) {
                output += `${key}=${value}\n`;
            }
        }
        writeFileSync(process.env.GITHUB_ENV, output, { flag: 'a' });
        console.log("✅ Config exported to GITHUB_ENV");
    } else {
        console.log("📋 Configuration (Local Debug):");
        console.log(envs);
    }
}

setup();
