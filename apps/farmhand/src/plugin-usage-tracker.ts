import { EventEmitter } from "node:events";
import { normalizePluginId } from "@refarm.dev/config";

export class PluginUsageTracker extends EventEmitter {
  private readonly effortPlugins = new Map<string, Set<string>>();
  private readonly pluginEfforts = new Map<string, Set<string>>();

  registerEffort(effortId: string, pluginIds: string[]): void {
    const plugins = new Set(pluginIds.map(normalizePluginId));
    this.effortPlugins.set(effortId, plugins);
    for (const pluginId of plugins) {
      let efforts = this.pluginEfforts.get(pluginId);
      if (!efforts) {
        efforts = new Set();
        this.pluginEfforts.set(pluginId, efforts);
      }
      efforts.add(effortId);
    }
  }

  releaseEffort(effortId: string): void {
    const plugins = this.effortPlugins.get(effortId);
    if (!plugins) return;
    this.effortPlugins.delete(effortId);
    for (const pluginId of plugins) {
      const efforts = this.pluginEfforts.get(pluginId);
      if (!efforts) continue;
      efforts.delete(effortId);
      if (efforts.size === 0) {
        this.pluginEfforts.delete(pluginId);
        this.emit(`idle:${pluginId}`);
      }
    }
  }

  isIdle(pluginId: string): boolean {
    const efforts = this.pluginEfforts.get(normalizePluginId(pluginId));
    return !efforts || efforts.size === 0;
  }

  onIdle(pluginId: string, callback: () => void): void {
    const normalizedPluginId = normalizePluginId(pluginId);
    if (this.isIdle(normalizedPluginId)) {
      callback();
      return;
    }
    this.once(`idle:${normalizedPluginId}`, callback);
  }
}
