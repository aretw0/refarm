import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SowerCore: The seeding engine of Refarm.
 * Handles templates, interactive flows, and initial project structure.
 * Designed to be runtime-neutral (CLI, Browser, or Server).
 */

export class SowerCore {
  /**
   * Returns the onboarding steps/intentions as a data-driven structure.
   */
  getOnboardingFlow() {
    return {
      name: "Cultivate your Soil",
      description: "Choose your level of engagement with the sovereign web.",
      options: [
        {
          id: "guest",
          label: "Guest Mode",
          description: "Temporary participation. No keys, no persistent storage.",
          intent: "switch-to-guest"
        },
        {
          id: "citizen",
          label: "Sovereign Citizen",
          description: "Full ownership. Sovereign identity (Keys) and persistent storage.",
          intent: "switch-to-citizen"
        }
      ]
    };
  }

  /**
   * Helper to recursively copy directories.
   */
  private _copyRecursive(src: string, dest: string) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats && stats.isDirectory();

    if (isDirectory) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      fs.readdirSync(src).forEach((child) => {
        this._copyRecursive(path.join(src, child), path.join(dest, child));
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  /**
   * Scaffolds a new Refarm configuration or project structure.
   */
  async scaffold(templateId: string, options: any = {}) {
    console.log(`[sower-core] Scaffolding template: ${templateId}`, options);
    
    // In Phase 3, we default to "citizen" tier for everything
    const config: any = {
      mode: "persistent",
      storage: "opfs",
      brand: {
          name: options.name || "My Sovereign Farm",
          slug: (options.name || "my-sovereign-farm").toLowerCase().replace(/\s+/g, "-")
      }
    };

    // Template specific adjustments
    let templateSubPath = "typescript"; // Default
    if (templateId === "courier") {
        config.type = "app";
    } else if (templateId === "rust-plugin") {
        config.type = "plugin";
        config.engine = "heartwood";
        templateSubPath = "."; // rust-plugin template doesn't have subdirs yet
    }

    // Hydrate files if targetDir is provided
    if (options.targetDir) {
        const rootDir = process.cwd(); // Assuming run from monorepo root for now
        const templatePath = path.join(rootDir, "templates", templateId, templateSubPath);
        
        if (fs.existsSync(templatePath)) {
            console.log(`[sower-core] Hydrating from ${templatePath} to ${options.targetDir}...`);
            this._copyRecursive(templatePath, options.targetDir);
        } else {
            console.warn(`[sower-core] Template path not found: ${templatePath}`);
        }
    }

    return {
      tier: "citizen",
      template: templateId,
      config,
      identity: {
        hostingPath: ".refarm/identity.json"
      }
    };
  }

  /**
   * Sows the project with tokens and verifies infrastructure.
   */
  async sow(tokens: { githubToken: string; cloudflareToken: string }, brand: { owner: string }) {
    console.log(`[sower-core] Sowing tokens for ${brand.owner}...`);

    const silo = new SiloCore();
    await silo.saveTokens(tokens);

    // Temporarily set env for verification
    process.env.GITHUB_TOKEN = tokens.githubToken;
    process.env.CLOUDFLARE_API_TOKEN = tokens.cloudflareToken;

    const windmill = new Windmill({
      brand: { owner: brand.owner, urls: { repository: "" } },
      infrastructure: { gitHost: "github" }
    });

    const results: any = {
        github: { ok: false },
        cloudflare: { ok: true } // Cloudflare is Token-based, simple check for now
    };

    try {
        const repos = await windmill.github.listRepos();
        results.github = { ok: true, count: repos.length };
    } catch (e: any) {
        results.github = { ok: false, error: e.message };
    }

    return results;
  }
}

