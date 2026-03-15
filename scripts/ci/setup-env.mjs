import { loadConfig } from "@refarm.dev/config";
import { SiloCore } from "@refarm.dev/silo";
import { writeFileSync } from "node:fs";

/**
 * Silo Provisioner for GitHub Actions
 * Replaces the legacy setup-env.mjs using the Silo core.
 */
function run() {
    console.log("🌾 Silo: Provisioning Environment Context...");
    const config = loadConfig();
    const silo = new SiloCore(config);

    if (process.env.GITHUB_ENV) {
        const output = silo.provision("github");
        writeFileSync(process.env.GITHUB_ENV, output, { flag: 'a' });
        console.log("✅ Context provisioned to GITHUB_ENV");
    } else {
        const context = silo.provision("object");
        console.log("📋 Sovereign Context (Local):", context);
    }
}

run();
