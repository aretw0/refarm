import {
  homesteadHostRendererCan,
  type HomesteadHostRendererDescriptor,
  type HomesteadHostSurfaceState,
  type HomesteadHostStreamState,
} from "@refarm.dev/homestead/sdk/host-renderer";
import type { TrustSummary } from "@refarm.dev/trust";
import type { RuntimeSummary } from "@refarm.dev/runtime";

export const REFARM_STATUS_SCHEMA_VERSION = 1 as const;

export interface RefarmStatusJson {
  schemaVersion: typeof REFARM_STATUS_SCHEMA_VERSION;
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
    schemaVersion: REFARM_STATUS_SCHEMA_VERSION,
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

export function isRefarmStatusJson(value: unknown): value is RefarmStatusJson {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== REFARM_STATUS_SCHEMA_VERSION) return false;

  const host = value.host;
  if (!isRecord(host)) return false;
  if (
    typeof host.app !== "string" ||
    typeof host.command !== "string" ||
    typeof host.profile !== "string" ||
    typeof host.mode !== "string"
  ) return false;

  const renderer = value.renderer;
  if (!isRecord(renderer)) return false;
  if (
    typeof renderer.id !== "string" ||
    typeof renderer.kind !== "string" ||
    !isStringArray(renderer.capabilities)
  ) return false;

  const runtime = value.runtime;
  if (!isRecord(runtime)) return false;
  if (
    typeof runtime.ready !== "boolean" ||
    typeof runtime.namespace !== "string" ||
    typeof runtime.databaseName !== "string"
  ) return false;

  const plugins = value.plugins;
  if (!isRecord(plugins)) return false;
  if (
    !isFiniteNumber(plugins.installed) ||
    !isFiniteNumber(plugins.active) ||
    !isFiniteNumber(plugins.rejectedSurfaces) ||
    !isFiniteNumber(plugins.surfaceActions)
  ) return false;

  const trust = value.trust;
  if (!isRecord(trust)) return false;
  if (
    typeof trust.profile !== "string" ||
    !isFiniteNumber(trust.warnings) ||
    !isFiniteNumber(trust.critical)
  ) return false;

  const streams = value.streams;
  if (!isRecord(streams)) return false;
  if (!isFiniteNumber(streams.active) || !isFiniteNumber(streams.terminal)) {
    return false;
  }

  return isStringArray(value.diagnostics);
}

export function assertRefarmStatusJson(
  value: unknown,
): asserts value is RefarmStatusJson {
  if (!isRefarmStatusJson(value)) {
    throw new Error(
      `Invalid Refarm status payload. Expected schemaVersion=${REFARM_STATUS_SCHEMA_VERSION}.`,
    );
  }
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

export function formatRefarmStatusJson(json: RefarmStatusJson): string {
  return JSON.stringify(toCanonicalRefarmStatusJson(json), null, 2);
}

function toCanonicalRefarmStatusJson(json: RefarmStatusJson): RefarmStatusJson {
  return {
    schemaVersion: json.schemaVersion,
    host: {
      app: json.host.app,
      command: json.host.command,
      profile: json.host.profile,
      mode: json.host.mode,
    },
    renderer: {
      id: json.renderer.id,
      kind: json.renderer.kind,
      capabilities: [...json.renderer.capabilities],
    },
    runtime: {
      ready: json.runtime.ready,
      databaseName: json.runtime.databaseName,
      namespace: json.runtime.namespace,
    },
    plugins: {
      installed: json.plugins.installed,
      active: json.plugins.active,
      rejectedSurfaces: json.plugins.rejectedSurfaces,
      surfaceActions: json.plugins.surfaceActions,
    },
    trust: {
      profile: json.trust.profile,
      warnings: json.trust.warnings,
      critical: json.trust.critical,
    },
    streams: {
      active: json.streams.active,
      terminal: json.streams.terminal,
    },
    diagnostics: [...json.diagnostics],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
