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
