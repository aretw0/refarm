import type {
  RuntimeNode,
  RuntimeTelemetryTarget,
  RuntimeTierTarget,
} from "@refarm.dev/runtime";
import { SowerCore } from "./core.js";

export type SowerHost = RuntimeTelemetryTarget & RuntimeTierTarget;

/**
 * The Sower (O Semeador) — Initial Seed & Onboarding Plugin.
 */
export class SowerPlugin {
  private core: SowerCore;

  constructor(private host: SowerHost) {
    this.core = new SowerCore();
  }

  async getOnboardingNode(): Promise<RuntimeNode> {
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
    const result = await this.core.scaffold(intent);
    
    if (result && result.tier) {
      await this.host.switchTier(result.tier);
    }
  }

  onEvent(event: string, payload: string) {
    console.info(`[sower] Received system event: ${event}`, payload);
    const data = JSON.parse(payload);
    
    if (event === "system:switch-tier" && data.tier === "guest") {
      console.log("[sower] Tier switched to guest. Injecting 'Guest Tutorial' node...");
      
      this.host.emitTelemetry({
        event: "node:created",
        payload: {
          "@context": "https://schema.org/",
          "@type": "Message",
          "@id": "urn:refarm:sower:welcome-guest",
          "name": "Welcome Guest",
          "text": "Your temporary workspace is active. Explore the tools below.",
          "refarm:renderType": "tutorial-step"
        }
      });
    }
  }
}

export { SowerCore };
