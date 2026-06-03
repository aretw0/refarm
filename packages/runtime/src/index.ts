export interface RuntimeSummary {
  ready: boolean;
  databaseName: string;
  namespace: string;
}

export type RuntimeEngineMode = "auto" | "rust" | "ts";
export type RuntimeActiveEngine = "rust" | "ts" | "unknown";
export type RuntimeAutostartMode = "always" | "ask" | "never";

export const RUNTIME_ENGINE_MODES = ["auto", "rust", "ts"] as const;
export const RUNTIME_AUTOSTART_MODES = ["ask", "always", "never"] as const;

export type RuntimeSelectionReason =
  | "configured-rust"
  | "configured-ts"
  | "auto-rust-available"
  | "auto-ts-fallback"
  | "configured-rust-missing-binary"
  | "unavailable";

export interface RuntimeEngineSummary {
  configuredEngine?: RuntimeEngineMode;
  activeEngine?: RuntimeActiveEngine;
}

export interface RuntimeStatusSummary {
  configuredEngine: RuntimeEngineMode;
  activeEngine: RuntimeActiveEngine;
  autostart: RuntimeAutostartMode;
  reason: RuntimeSelectionReason;
  sidecarUrl?: string;
  sidecarUrlSource?: string;
  ready?: boolean;
  startCommand?: string;
  issue?: string;
}

export function createNullRuntimeSummary(): RuntimeSummary {
  return { ready: false, databaseName: "", namespace: "" };
}

export function createNullRuntimeStatusSummary(): RuntimeStatusSummary {
  return {
    configuredEngine: "auto",
    activeEngine: "unknown",
    autostart: "ask",
    reason: "unavailable",
    ready: false,
  };
}

export function parseRuntimeEngineMode(value: unknown): RuntimeEngineMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (RUNTIME_ENGINE_MODES as readonly string[]).includes(normalized)
    ? (normalized as RuntimeEngineMode)
    : null;
}

export function parseRuntimeAutostartMode(
  value: unknown,
): RuntimeAutostartMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (RUNTIME_AUTOSTART_MODES as readonly string[]).includes(normalized)
    ? (normalized as RuntimeAutostartMode)
    : null;
}

export type {
  RuntimeHost,
  RuntimeNode,
  RuntimeNodeStoreTarget,
  RuntimeObserverTarget,
  RuntimePluginHandle,
  RuntimePluginHost,
  RuntimePluginInstance,
  RuntimePluginLoader,
  RuntimePluginLoaderTarget,
  RuntimePluginManifest,
  RuntimePluginReader,
  RuntimePluginRegistry,
  RuntimePluginStateTarget,
  RuntimePluginState,
  RuntimeQueryTarget,
  RuntimeTaskTarget,
  RuntimeTelemetryEvent,
  RuntimeTelemetryTarget,
  RuntimeTierTarget,
} from "./host.js";
export { createRuntimeSummaryFromTractor } from "./tractor-adapter.js";
