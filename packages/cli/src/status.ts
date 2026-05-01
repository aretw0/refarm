import {
  homesteadHostRendererCan,
  type HomesteadHostRendererDescriptor,
  type HomesteadHostRendererSnapshot,
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
    snapshot?: HomesteadHostRendererSnapshot;
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
      rejectedSurfaces: plugins?.snapshot?.surfaces?.rejected?.length ?? 0,
      surfaceActions: plugins?.snapshot?.surfaces?.actions?.length ?? 0,
    },
    trust,
    streams: {
      active: streams?.active ?? 0,
      terminal: streams?.terminal ?? 0,
    },
    diagnostics: buildStatusDiagnostics(renderer),
  };
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
