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
  RuntimePluginHost,
  RuntimePluginInstance,
  RuntimePluginLoader,
  RuntimePluginLoaderTarget,
  RuntimePluginManifest,
  RuntimePluginReader,
  RuntimePluginRegistry,
  RuntimeTaskTarget,
} from "./host.js";
export { createRuntimeSummaryFromTractor } from "./tractor-adapter.js";
