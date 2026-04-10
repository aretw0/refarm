import { loadConfig } from "@refarm.dev/config";
import { SiloCore } from "@refarm.dev/silo";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function readPackageScope(packageJsonPath) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const [scope] = String(packageJson.name || "").split("/");
    return scope?.startsWith("@") ? scope : undefined;
}

function collectScopes(rootDir, config) {
    const configuredScopes = config.brand?.scopes || {};
    const derivedScopes = {
        dev: readPackageScope(path.join(rootDir, "apps/dev/package.json")),
        me: readPackageScope(path.join(rootDir, "apps/me/package.json")),
        farmhand: readPackageScope(path.join(rootDir, "apps/farmhand/package.json"))
    };

    return { ...derivedScopes, ...configuredScopes };
}

/**
 * Silo Provisioner for GitHub Actions
 * Replaces the legacy setup-env.mjs using the Silo core.
 */
async function run() {
    console.log("🌾 Silo: Provisioning Environment Context...");
    const rootDir = process.cwd();
    const config = loadConfig();
    const silo = new SiloCore(config);
    const tokens = await silo.provision("object");
    const envs = {
        REFARM_BRAND_NAME: config.brand?.name,
        REFARM_BRAND_SLUG: config.brand?.slug,
        REFARM_BRAND_OWNER: config.brand?.owner,
        REFARM_GIT_HOST: config.infrastructure?.gitHost,
        REFARM_SITE_URL: config.brand?.urls?.site,
        REFARM_REPO_URL: config.brand?.urls?.repository,
        ...tokens
    };

    for (const [key, value] of Object.entries(collectScopes(rootDir, config))) {
        if (value) {
            envs[`REFARM_SCOPE_${key.toUpperCase()}`] = value;
        }
    }

    if (process.env.GITHUB_ENV) {
        const output = Object.entries(envs)
            .filter(([, value]) => value)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");
        writeFileSync(process.env.GITHUB_ENV, output, { flag: 'a' });
        console.log("✅ Context provisioned to GITHUB_ENV");
    } else {
        console.log("📋 Sovereign Context (Local):", envs);
    }
}

await run();
