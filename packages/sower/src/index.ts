import { SovereignNode, Tractor } from "@refarm.dev/tractor";

/**
 * The Sower (O Semeador) — Initial Seed & Onboarding Plugin.
 */
export class SowerPlugin {
  constructor(private tractor: Tractor) {}

  async getOnboardingNode(): Promise<SovereignNode> {
    return {
      "@context": "https://schema.org/",
      "@type": "EntryPoint",
      "@id": "urn:refarm:sower:onboarding",
      "name": "Cultivate your Soil",
      "description": "Choose your level of engagement with the sovereign web.",
      "refarm:renderType": "onboarding",
      "refarm:options": [
        {
          "id": "guest",
          "label": "Guest Mode",
          "description": "Temporary participation. No chaves, no persistent storage.",
          "intent": "switch-to-guest"
        },
        {
          "id": "citizen",
          "label": "Sovereign Citizen",
          "description": "Full ownership. Nostr identity and persistent OPFS storage.",
          "intent": "switch-to-citizen"
        }
      ]
    };
  }

  async handleIntent(intent: string) {
    if (intent === "switch-to-guest") {
      await this.tractor.switchTier("guest");
    } else if (intent === "switch-to-citizen") {
      await this.tractor.switchTier("citizen");
    }
  }

  onEvent(event: string, payload: string) {
    console.info(`[sower] Received system event: ${event}`, payload);
    const data = JSON.parse(payload);
    
    // Composable Logic (n8n-style):
    // When switching to guest, we "seed" the next flow.
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
