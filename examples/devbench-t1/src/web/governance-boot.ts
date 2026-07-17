import { bootCapabilityWebFace } from "@refarm.dev/capability-homestead-surface/boot";

import { createGovernanceWebRegistry } from "./governance-app.js";

/**
 * The GOVERNANCE web face — the T1 headline as a real, browser-safe page. The SAME `governance-poc`
 * verb that produces the writeup's scorecard on the CLI runs on load, and its `governanceHtml`
 * (the weighted scorecard + the 2 policy modes × 3 extension behaviours + metrics) mounts as the
 * dashboard above the launcher card. Re-running the verb from its card re-paints the scorecard via
 * B2. The registry is browser-safe (governance-app.ts) so this boots with no node/WASM in the
 * bundle — the T1 "extensibility-as-a-risk-decision" proof, shown from data, in the browser.
 */
export async function bootGovernance(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	try {
		const registry = createGovernanceWebRegistry();
		await bootCapabilityWebFace({
			databaseName: "devbench-governance-web",
			namespace: "devbench",
			registry,
			// Run governance-poc on load and mount its governanceHtml as the headline dashboard.
			content: { verb: "governance-poc", field: "governanceHtml" },
			surface: {
				pluginId: "@refarm.dev/devbench-governance",
				title: "Governança de extensões",
				content: (data) => (typeof data.governanceHtml === "string" ? data.governanceHtml : ""),
			},
		});
		overlay?.remove();
	} catch (error) {
		console.error("[devbench-t1] governance boot failed", error);
		if (overlay) {
			overlay.textContent = `Falha ao abrir a governança: ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
	}
}
