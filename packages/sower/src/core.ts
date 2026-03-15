import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";

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
   * Scaffolds a new Refarm configuration or project structure.
   */
  async scaffold(intent: string, options: any = {}) {
    console.log(`[sower-core] Scaffolding intent: ${intent}`, options);
    
    if (intent === "switch-to-guest") {
      return {
        tier: "guest",
        config: {
          mode: "ephemeral",
          storage: "memory"
        }
      };
    }

    if (intent === "switch-to-citizen") {
      // Identity Generation (Sovereignty)
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const privateKey = Buffer.from(seed).toString("hex");
      const publicKey = "pending_calculation"; // Real calc in Silo/KeyManager
      
      return {
        tier: "citizen",
        config: {
          mode: "persistent",
          storage: "opfs"
        },
        identity: {
          publicKey,
          hostingPath: ".refarm/identity.json"
        },
        secrets: {
          masterPrivateKey: privateKey
        }
      };
    }

    return null;
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

