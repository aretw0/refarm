/**
 * @refarm.dev/sower — browser-safe entrypoint
 *
 * SowerCore.scaffold() and SowerCore.sow() use node:fs and node:path for template
 * hydration and cannot run in the browser. The onboarding flow data is pure static
 * JSON-LD — it works in any environment.
 *
 * SowerPlugin is not exported here because it depends on Tractor's PluginHost, which
 * has its own browser stub in @refarm.dev/tractor. Consumers building the browser UI
 * should use the static data helpers directly.
 */

import { SovereignNode, Tractor } from "@refarm.dev/tractor";

const NODE_ERROR =
  "[sower] Scaffolding and token provisioning require the Node.js runtime " +
  "and cannot run in the browser.";

/**
 * Browser-safe subset of SowerCore.
 *
 * - getOnboardingFlow(): works — returns pure static data
 * - scaffold(), sow(), hydrateFromRemote(): throw (fs/network/process.env)
 * - _copyRecursive(): throws (node:fs)
 */
export class SowerCore {
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

  async scaffold(_templateId: string, _options: any = {}): Promise<never> {
    throw new Error(NODE_ERROR);
  }

  async sow(_tokens: { githubToken: string; cloudflareToken: string }, _brand: { owner: string }): Promise<never> {
    throw new Error(NODE_ERROR);
  }

  async hydrateFromRemote(_nodeId: string, _gatewayUrl: string): Promise<never> {
    throw new Error(NODE_ERROR);
  }
}

/**
 * The Sower (O Semeador) — Initial Seed & Onboarding Plugin (Browser safe).
 */
export class SowerPlugin {
  private core: SowerCore;

  constructor(private tractor: Tractor) {
    this.core = new SowerCore();
  }

  async getOnboardingNode(): Promise<SovereignNode> {
    const flow = this.core.getOnboardingFlow();
    
    return {
      "@context": "https://schema.org/",
      "@type": "EntryPoint",
      "@id": "urn:refarm:sower:onboarding",
      "name": flow.name,
      "description": flow.description,
      "refarm:renderType": "onboarding",
      "refarm:options": flow.options.map(opt => ({
        ...opt,
        "label": opt.label,
        "description": opt.description,
        "intent": opt.intent
      }))
    };
  }

  async handleIntent(intent: string) {
    // This will throw in the browser via SowerCore.scaffold
    const result = await this.core.scaffold(intent);
    
    if (result && (result as any).tier) {
      await this.tractor.switchTier((result as any).tier as any);
    }
  }

  onEvent(event: string, payload: string) {
    console.info(`[sower] Received system event: ${event}`, payload);
    const data = JSON.parse(payload);
    
    if (event === "system:switch-tier" && data.tier === "guest") {
      console.log("[sower] Tier switched to guest. Injecting 'Guest Tutorial' node...");
      
      this.tractor.emitTelemetry({
        event: "node:created",
        payload: {
          "@context": "https://schema.org/",
          "@type": "Message",
          "@id": "urn:refarm:sower:welcome-guest",
          "name": "Welcome Guest",
          "text": "Your temporary soil is now active. Explore the tools below.",
          "refarm:renderType": "tutorial-step"
        }
      });
    }
  }
}
