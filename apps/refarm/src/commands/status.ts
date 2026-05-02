import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { Tractor } from "@refarm.dev/tractor";
import { isHomesteadHostRendererKind } from "@refarm.dev/homestead/sdk/host-renderer";
import {
  buildRefarmStatusJson,
  formatRefarmStatusMarkdown,
  type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { createRuntimeSummaryFromTractor } from "@refarm.dev/runtime";
import { createTrustSummaryFromTractor } from "@refarm.dev/trust";
import { resolveRefarmRenderer } from "../renderers.js";

interface StorageAdapter {
  ensureSchema(): Promise<void>;
  storeNode(id: string, type: string, context: string, payload: unknown, sourcePlugin: string): Promise<void>;
  queryNodes(type: string): Promise<unknown[]>;
  execute(sql: string, args?: unknown): Promise<unknown[]>;
  query<T>(sql: string, args?: unknown): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface IdentityAdapter {
  publicKey: string | undefined;
}

function createMemoryStorage(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async ensureSchema() {},
    async storeNode(id, type, context, payload, sourcePlugin) {
      store.set(id, { id, type, context, payload, sourcePlugin });
    },
    async queryNodes(type: string) {
      return Array.from(store.values()).filter((r) => (r as { type: string }).type === type);
    },
    async execute(_sql: string, _args?: unknown) { return []; },
    async query<T>(_sql: string, _args?: unknown): Promise<T[]> { return []; },
    async transaction<T>(fn: () => Promise<T>) { return fn(); },
    async close() {},
  };
}

function createEphemeralIdentity(): IdentityAdapter {
  return { publicKey: undefined };
}

function readNamespaceFromConfig(): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "refarm.config.json"), "utf-8");
    return (JSON.parse(raw) as { brand?: { slug?: string } }).brand?.slug;
  } catch {
    return undefined;
  }
}

function printStatusSummary(json: RefarmStatusJson): void {
  console.log(`Host:      ${json.host.app} (${json.host.mode})`);
  console.log(`Renderer:  ${json.renderer.id} (${json.renderer.kind})`);
  console.log(`Runtime:   ${json.runtime.ready ? "ready" : "not ready"} — ${json.runtime.namespace}`);
  console.log(`Trust:     ${json.trust.profile} — warnings: ${json.trust.warnings}, critical: ${json.trust.critical}`);
  console.log(`Plugins:   ${json.plugins.installed} installed, ${json.plugins.active} active`);
  console.log(`Streams:   ${json.streams.active} active, ${json.streams.terminal} terminal`);
  if (json.diagnostics.length > 0) {
    console.log("Diagnostics:");
    for (const d of json.diagnostics) console.log(`  - ${d}`);
  }
}

export const statusCommand = new Command("status")
  .description("Report host status")
  .option(
    "--renderer <kind>",
    "Renderer mode: web | tui | headless",
    "headless",
  )
  .option("--markdown", "Output markdown report")
  .option("--json", "Output machine-readable JSON")
  .action(async (options: { json?: boolean; markdown?: boolean; renderer?: string }) => {
    if (options.json && options.markdown) {
      throw new Error("Choose only one output format: --json or --markdown.");
    }

    const requestedRenderer = options.renderer ?? "headless";
    if (!isHomesteadHostRendererKind(requestedRenderer)) {
      throw new Error(
        `Invalid renderer kind \"${requestedRenderer}\". Use one of: web, tui, headless.`,
      );
    }
    const renderer = resolveRefarmRenderer(requestedRenderer);

    const tractor = await Tractor.boot({
      namespace: readNamespaceFromConfig() ?? "refarm-main",
      storage: createMemoryStorage(),
      identity: createEphemeralIdentity(),
      logLevel: "silent",
    });

    const runtime = createRuntimeSummaryFromTractor(tractor);
    const trust = createTrustSummaryFromTractor(tractor);

    const json = buildRefarmStatusJson({
      host: {
        app: "apps/refarm",
        command: "refarm",
        profile: "dev",
        mode: renderer.kind,
      },
      renderer,
      runtime,
      trust,
    });

    if (options.json) {
      console.log(JSON.stringify(json, null, 2));
    } else if (options.markdown) {
      console.log(formatRefarmStatusMarkdown(json));
    } else {
      printStatusSummary(json);
    }

    await tractor.shutdown?.();
  });
