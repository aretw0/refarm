import { matchDispatchResults } from "@refarm.dev/dispatch-result-contract-v1";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadQualityPluginComponent, type IntegrationPlugin, type TractorBridge } from "./index.js";

// Drives the REAL transpiled quality integration plugin; needs `pnpm build:plugin`
// to have produced `pkg-plugin/`. Gitignored + rebuilt, so this SKIPS when absent.
const pkgEntry = fileURLToPath(new URL("../pkg-plugin/quality_plugin.js", import.meta.url));
const componentBuilt = existsSync(pkgEntry);
const pkgDir = fileURLToPath(new URL("../pkg-plugin/", import.meta.url));

/** A functional test tractor-bridge — captures stored nodes (the plugin's output),
 * mirrors the host's query-nodes-by-@type. Same seam the real host implements. */
function makeTractorBridge(): { bridge: TractorBridge; stored: string[] } {
	const stored: string[] = [];
	return {
		bridge: {
			storeNode(node: string) {
				stored.push(node);
				return `node:${stored.length}`;
			},
			getNode(id: string) {
				return { tag: "err", val: { tag: "not-found", val: id } };
			},
			queryNodes(nodeType: string, limit: number) {
				return stored
					.filter((n) => {
						try {
							return (JSON.parse(n) as { "@type"?: string })["@type"] === nodeType;
						} catch {
							return false;
						}
					})
					.slice(0, limit);
			},
			requestPermission() {
				return true;
			},
			getIdentity() {
				return {
					tag: "ok",
					val: { identityType: "guest", storageTier: "ephemeral", identifier: "test" },
				};
			},
			getPluginApi(name: string) {
				return { tag: "err", val: { tag: "not-found", val: name } };
			},
			callPlugin(pluginId: string, _verb: string, _inputJson: string): string {
				throw { payload: { tag: "not-found", val: pluginId } };
			},
			emitTelemetry() {},
		},
		stored,
	};
}

async function loadPlugin(bridge: TractorBridge): Promise<{ integration: IntegrationPlugin }> {
	const integration = await loadQualityPluginComponent({
		pkgDir,
		entry: "quality_plugin.js",
		bridge,
	});
	return { integration };
}

const SUBJECT = "As an AI language model, I cannot browse the web.";
const PROFILE = {
	name: "text-tells",
	rules: [
		{
			id: "ai-tell",
			severity: "warn",
			description: "flags an AI self-reference tell",
			check: { type: "regex", pattern: "AI language model" },
		},
		{
			id: "absent",
			severity: "warn",
			description: "should not match",
			check: { type: "regex", pattern: "zzz-not-present" },
		},
	],
};

describe.skipIf(!componentBuilt)(
	"quality integration plugin (second real consumer of dispatch-result:v1)",
	() => {
		it("exports integration with quality metadata", async () => {
			const { bridge } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);
			const meta = integration.metadata();
			expect(meta.name).toBe("quality");
			expect(meta.supportedTypes).toContain("DispatchResult");
		});

		it("on-event('quality:dispatch') emits findings a caller correlates by replyRef", async () => {
			const { bridge, stored } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);

			integration.onEvent(
				"quality:dispatch",
				JSON.stringify({ subject: SUBJECT, profile: PROFILE, replyRef: "q-1" }),
			);

			// The SAME correlation the vault uses — one contract, two families.
			const mine = matchDispatchResults(stored, "q-1", "check");
			expect(mine).toHaveLength(1);
			const result = mine[0]?.["result"] as { findings: { ruleId: string }[] };
			expect(result.findings).toHaveLength(1);
			expect(result.findings[0]?.ruleId).toBe("ai-tell");
		});

		it("ignores a non-quality event and a malformed payload", async () => {
			const { bridge, stored } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);
			integration.onEvent("user:prompt", "hi");
			expect(() => integration.onEvent("quality:dispatch", "{ not json")).not.toThrow();
			expect(stored).toHaveLength(0);
		});
	},
);
