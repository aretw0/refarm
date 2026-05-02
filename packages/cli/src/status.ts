import {
  homesteadHostRendererCan,
  type HomesteadHostRendererDescriptor,
  type HomesteadHostSurfaceState,
  type HomesteadHostStreamState,
} from "@refarm.dev/homestead/sdk/host-renderer";
import type { TrustSummary } from "@refarm.dev/trust";
import type { RuntimeSummary } from "@refarm.dev/runtime";

export interface RefarmStatusJson {
  schemaVersion: 1;
  host: { app: string; command: string; profile: string; mode: string };
  renderer: { id: string; kind: string; capabilities: readonly string[] };
  runtime: RuntimeSummary;
  plugins: {
    installed: number;
    active: number;
    rejectedSurfaces: number;
    surfaceActions: number;
  };
  trust: TrustSummary;
  streams: { active: number; terminal: number };
  diagnostics: string[];
}

export interface RefarmStatusOptions {
  host: { app: string; command: string; profile: string; mode: string };
  renderer: HomesteadHostRendererDescriptor;
  runtime: RuntimeSummary;
  trust: TrustSummary;
  streams?: HomesteadHostStreamState;
  plugins?: {
    installed?: number;
    active?: number;
    surfaces?: HomesteadHostSurfaceState;
  };
}

export function buildRefarmStatusJson(
  options: RefarmStatusOptions,
): RefarmStatusJson {
  const { host, renderer, runtime, trust, streams, plugins } = options;
  return {
    schemaVersion: 1,
    host,
    renderer: {
      id: renderer.id,
      kind: renderer.kind,
      capabilities: renderer.capabilities,
    },
    runtime,
    plugins: {
      installed: plugins?.installed ?? 0,
      active: plugins?.active ?? 0,
      rejectedSurfaces: plugins?.surfaces?.rejected?.length ?? 0,
      surfaceActions: plugins?.surfaces?.actions?.length ?? 0,
    },
    trust,
    streams: {
      active: streams?.active ?? 0,
      terminal: streams?.terminal ?? 0,
    },
    diagnostics: buildStatusDiagnostics(renderer),
  };
}

export function formatRefarmStatusMarkdown(json: RefarmStatusJson): string {
  const diagnostics = json.diagnostics.length > 0
    ? json.diagnostics.map((diagnostic) => `- ${diagnostic}`).join("\n")
    : "- none";

  const frontmatter = [
    "---",
    `schemaVersion: ${json.schemaVersion}`,
    "host:",
    `  app: ${JSON.stringify(json.host.app)}`,
    `  command: ${JSON.stringify(json.host.command)}`,
    `  profile: ${JSON.stringify(json.host.profile)}`,
    `  mode: ${JSON.stringify(json.host.mode)}`,
    "renderer:",
    `  id: ${JSON.stringify(json.renderer.id)}`,
    `  kind: ${JSON.stringify(json.renderer.kind)}`,
    ...(json.renderer.capabilities.length > 0
      ? [
          "  capabilities:",
          ...json.renderer.capabilities.map((capability) =>
            `    - ${JSON.stringify(capability)}`,
          ),
        ]
      : ["  capabilities: []"]),
    "runtime:",
    `  ready: ${json.runtime.ready}`,
    `  namespace: ${JSON.stringify(json.runtime.namespace)}`,
    `  databaseName: ${JSON.stringify(json.runtime.databaseName)}`,
    "trust:",
    `  profile: ${JSON.stringify(json.trust.profile)}`,
    `  warnings: ${json.trust.warnings}`,
    `  critical: ${json.trust.critical}`,
    "plugins:",
    `  installed: ${json.plugins.installed}`,
    `  active: ${json.plugins.active}`,
    `  rejectedSurfaces: ${json.plugins.rejectedSurfaces}`,
    `  surfaceActions: ${json.plugins.surfaceActions}`,
    "streams:",
    `  active: ${json.streams.active}`,
    `  terminal: ${json.streams.terminal}`,
    `diagnosticsCount: ${json.diagnostics.length}`,
    "---",
  ].join("\n");

  return [
    frontmatter,
    "",
    "# Refarm Status",
    "",
    `- Schema: v${json.schemaVersion}`,
    `- Host: ${json.host.app} (${json.host.mode})`,
    `- Renderer: ${json.renderer.id} (${json.renderer.kind})`,
    `- Runtime: ${json.runtime.ready ? "ready" : "not ready"} (${json.runtime.namespace})`,
    `- Trust: ${json.trust.profile} (warnings: ${json.trust.warnings}, critical: ${json.trust.critical})`,
    `- Plugins: ${json.plugins.installed} installed, ${json.plugins.active} active`,
    `- Streams: ${json.streams.active} active, ${json.streams.terminal} terminal`,
    "",
    "## Diagnostics",
    diagnostics,
  ].join("\n");
}

function buildStatusDiagnostics(
  renderer: HomesteadHostRendererDescriptor,
): string[] {
  const diagnostics: string[] = [];
  if (!homesteadHostRendererCan(renderer, "interactive")) {
    diagnostics.push("renderer:non-interactive");
  }
  if (!homesteadHostRendererCan(renderer, "rich-html")) {
    diagnostics.push("renderer:no-rich-html");
  }
  return diagnostics;
}
