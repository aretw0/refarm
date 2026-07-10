import { matchDispatchResults } from "@refarm.dev/dispatch-result-contract-v1";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadVaultPluginComponent, type IntegrationPlugin, type TractorBridge } from "./index.js";

// This suite drives the REAL transpiled integration-plugin component, so it needs
// `pnpm build:plugin` (esbuild bundle + jco componentize + transpile) to have
// produced `pkg-plugin/`. Gitignored + rebuilt, so — like surface.test.ts — this
// SKIPS when the pkg is absent instead of failing the repo-wide test run.
const pkgEntry = fileURLToPath(new URL("../pkg-plugin/vault_plugin.js", import.meta.url));
const componentBuilt = existsSync(pkgEntry);
const pkgDir = fileURLToPath(new URL("../pkg-plugin/", import.meta.url));

/**
 * A FUNCTIONAL test tractor-bridge — the host capability the plugin imports. It
 * captures every stored node (the plugin's OUTPUT channel), and queryNodes reads
 * them back by @type. This is the exact seam the real tractor host implements
 * (packages/tractor/src/host/wasi_bridge/core.rs) — here we implement it in the
 * test so we can prove the plugin's on-event → store-node flow WITHOUT the runtime.
 */
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
			getPluginApi(name: string): string {
				// jco lowers a `result<node-id, plugin-error>` host import by wrapping
				// the return in `{tag:'ok'}` and mapping a THROW to `{tag:'err'}` — but
				// ONLY if the thrown value carries a `.payload` (a plain Error re-throws
				// and traps the guest, per getErrorPayload). No provider is loaded in
				// this unit test, so throw the tagged err variant; vault's checkQuality
				// receives it as a `result` err and degrades.
				throw { payload: { tag: "not-found", val: name } };
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
	const integration = await loadVaultPluginComponent({
		pkgDir,
		entry: "vault_plugin.js",
		bridge,
	});
	return { integration };
}

const NOTE = {
	path: "20-Projects/demanda-42.md",
	text: "---\ntitle: Demanda 42\nstate: doing\n---\n\nalpha body #project\n",
};
const EXTRACT_PROFILE = {
	name: "p",
	rules: [
		{
			id: "extract-frontmatter",
			verb: "extract",
			match: JSON.stringify({ type: "frontmatter", recordType: "refarm:VaultRecord" }),
		},
	],
};

describe.skipIf(!componentBuilt)(
	"vault integration plugin (runs through the real runtime contract)",
	() => {
		it("exports the canonical integration interface with vault metadata", async () => {
			const { bridge } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);
			const meta = integration.metadata();
			expect(meta.name).toBe("vault");
			expect(meta.supportedTypes).toContain("refarm:VaultRecord");
		});

		it("on-event('vault:dispatch', extract) stores a KnowledgeRecord node via tractor-bridge", async () => {
			const { bridge, stored } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);

			integration.onEvent(
				"vault:dispatch",
				JSON.stringify({ verb: "extract", note: NOTE, profile: EXTRACT_PROFILE }),
			);

			// The plugin ran surface.run and emitted the record OUT through store-node.
			const records = stored
				.map((n) => JSON.parse(n) as { "@type"?: string; id?: string; fields?: unknown })
				.filter((n) => n["@type"] === "refarm:VaultRecord");
			expect(records).toHaveLength(1);
			expect(records[0]?.id).toBe(NOTE.path);
			expect(records[0]?.fields).toEqual({ title: "Demanda 42", state: "doing" });
		});

		it("emits a dispatch-result:v1 node a caller correlates by replyRef", async () => {
			const { bridge, stored } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);
			integration.onEvent(
				"vault:dispatch",
				JSON.stringify({
					verb: "extract",
					note: NOTE,
					profile: EXTRACT_PROFILE,
					replyRef: "req-1",
				}),
			);
			// The vault is a CONSUMER of the shared dispatch-result:v1 contract — a
			// caller recovers its result by content correlation (replyRef), the same
			// way for ANY async plugin, not a vault-specific @type or a formula.
			const mine = matchDispatchResults(stored, "req-1", "extract");
			expect(mine).toHaveLength(1);
			expect(mine[0]?.["refarm:replyRef"]).toBe("req-1");
			expect(mine[0]?.["refarm:result"]).toBeDefined();
		});

		it("ignores an event that is not vault:dispatch (no nodes stored)", async () => {
			const { bridge, stored } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);
			integration.onEvent("user:prompt", "hello");
			expect(stored).toHaveLength(0);
		});

		it("ignores a malformed dispatch payload without throwing", async () => {
			const { bridge, stored } = makeTractorBridge();
			const { integration } = await loadPlugin(bridge);
			expect(() => integration.onEvent("vault:dispatch", "{ not json")).not.toThrow();
			expect(stored).toHaveLength(0);
		});
	},
);
