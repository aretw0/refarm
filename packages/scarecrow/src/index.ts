import type {
  RuntimeNode,
  RuntimeObserverTarget,
  RuntimePluginStateTarget,
  RuntimeQueryTarget,
  RuntimeTelemetryEvent,
  RuntimeTelemetryTarget,
} from "@refarm.dev/runtime";

/**
 * The Scarecrow (O Espantalho) — System Auditor Plugin.
 * 
 * Responsibilities:
 * 1. Passive observation of the Telemetry Bus.
 * 2. Evaluation of "Good Citizenship" (A11y & Performance).
 * 3. Notifying the Shell of violations.
 */
export interface ScarecrowConfig {
  maxUpdateVelocity: number;
  minA11yScore: number;
  strobeDetectionEnabled: boolean;
}

export type ScarecrowHost =
  & RuntimeObserverTarget
  & RuntimePluginStateTarget
  & RuntimeQueryTarget
  & RuntimeTelemetryTarget;

/**
 * The Scarecrow (O Espantalho) — System Auditor Plugin.
 */
export class ScarecrowPlugin {
  private _alerts: Array<{ pluginId: string, reason: string, timestamp: number }> = [];
  private _config: ScarecrowConfig = {
    maxUpdateVelocity: 60,
    minA11yScore: 0.7,
    strobeDetectionEnabled: true
  };

  constructor(private host: ScarecrowHost) {
    this.setupObserver();
    this.loadConfig();
  }

  /**
   * Loads configuration from the sovereign graph.
   */
  private async loadConfig() {
    try {
      // Query for a specific configuration node for Scarecrow
      const nodes = await this.host.queryNodes<RuntimeNode>("ScarecrowConfig");
      if (nodes.length > 0) {
        const remoteConfig = nodes[0] as unknown as Partial<ScarecrowConfig>;
        this._config = { ...this._config, ...remoteConfig };
        console.info("[scarecrow] Configuration loaded from graph:", this._config);
      }
    } catch (e) {
      console.warn("[scarecrow] Failed to load config from graph, using defaults.", e);
    }
  }

  private setupObserver() {
    this.host.observe((data: RuntimeTelemetryEvent) => {
      const payload = data.payload as Record<string, unknown> | undefined;
      // 1. Monitor Performance
      const updateVelocity = payload?.updateVelocity as number | undefined;
      if (data.event === "ui:performance" && updateVelocity !== undefined && updateVelocity > this._config.maxUpdateVelocity) {
        const pluginId = data.pluginId || "unknown";
        this.emitAlert(pluginId, `Excessive DOM updates (${updateVelocity}/sec, threshold: ${this._config.maxUpdateVelocity})`);
        
        // Active Enforcement via Headless States
        this.host.setPluginState(pluginId, "throttled");
        
        setTimeout(() => {
          this.host.setPluginState(pluginId, "running");
        }, 2000);
      }

      // 2. Monitor A11y (if reported)
      const a11yScore = payload?.a11yScore as number | undefined;
      if (data.event === "ui:a11y_audit" && a11yScore !== undefined && a11yScore < this._config.minA11yScore) {
        this.emitAlert(data.pluginId || "unknown", `Low Accessibility Score (${a11yScore}, threshold: ${this._config.minA11yScore})`);
      }

      // 3. Monitor Strobe (if reported)
      if (this._config.strobeDetectionEnabled && data.event === "ui:strobe_alert") {
        this.emitAlert(data.pluginId || "unknown", "Potential seizure hazard detected!");
      }

      // 4. Configuration Update Event (Seamless/Real-time)
      if (data.event === "system:config_updated" && payload?.["pluginId"] === "scarecrow") {
         this._config = { ...this._config, ...(payload["config"] as Partial<ScarecrowConfig>) };
         console.info("[scarecrow] Real-time threshold update:", this._config);
      }
    });
  }

  private emitAlert(pluginId: string, reason: string) {
    const alert = { pluginId, reason, timestamp: Date.now() };
    this._alerts.push(alert);
    
    console.warn(`[scarecrow] Alert for ${pluginId}: ${reason}`);

    // Emit a system telemetry event that the Shell can catch for Toast notifications
    this.host.emitTelemetry({
      event: "system:alert",
      pluginId,
      payload: { reason, severity: "warn" }
    });
  }

  getAlerts() {
    return [...this._alerts];
  }

  getSystemHealth(): number {
    if (this._alerts.length === 0) return 1.0;
    const recentAlerts = this._alerts.filter(a => Date.now() - a.timestamp < 60000);
    return Math.max(0, 1.0 - (recentAlerts.length * 0.1));
  }
}
