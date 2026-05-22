export interface RuntimeSummary {
  ready: boolean;
  databaseName: string;
  namespace: string;
}

export type RuntimeEngineMode = "auto" | "rust" | "ts";
export type RuntimeActiveEngine = "rust" | "ts" | "unknown";
export type RuntimeAutostartMode = "always" | "ask" | "never";

export type RuntimeSelectionReason =
  | "configured-rust"
  | "configured-ts"
  | "auto-rust-available"
  | "auto-ts-fallback"
  | "configured-rust-missing-binary"
  | "unavailable";

export interface RuntimeStatusSummary {
  configuredEngine: RuntimeEngineMode;
  activeEngine: RuntimeActiveEngine;
  autostart: RuntimeAutostartMode;
  reason: RuntimeSelectionReason;
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
