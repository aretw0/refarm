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
