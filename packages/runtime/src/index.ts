export interface RuntimeSummary {
  ready: boolean;
  databaseName: string;
  namespace: string;
}

export function createNullRuntimeSummary(): RuntimeSummary {
  return { ready: false, databaseName: "", namespace: "" };
}

export type {
  RuntimeHost,
  RuntimeNode,
  RuntimeObserverTarget,
  RuntimePluginHost,
  RuntimePluginInstance,
  RuntimePluginLoader,
  RuntimePluginLoaderTarget,
  RuntimePluginManifest,
  RuntimePluginReader,
  RuntimePluginRegistry,
  RuntimePluginStateTarget,
  RuntimeQueryTarget,
  RuntimeTaskTarget,
  RuntimeTelemetryEvent,
  RuntimeTelemetryTarget,
  RuntimeTierTarget,
} from "./host.js";
export { createRuntimeSummaryFromTractor } from "./tractor-adapter.js";
