/// <reference lib="dom" />
import { Tractor, type TelemetryEvent } from "@refarm.dev/tractor";

/**
 * Herald Plugin (O Arauto)
 * 
 * Responsible for presenting the Refarm identity and loaded plugins.
 */
export class HeraldPlugin {
  private _logs: string[] = [];

  constructor(private tractor: Tractor) {
    this.setupHerald();
  }

  private setupHerald() {
    this.tractor.observe((data: TelemetryEvent) => {
      if (data.event === "plugin:load") {
        const plugin = this.tractor.plugins.get(data.pluginId!);
        const version = plugin?.manifest.version || "0.0.0";
        const info = `  🚜 [plugin] ${data.pluginId} v${version}`;
        this._logs.push(info);
      }
    });
  }

  public monitorLifecycle() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // High-level intent: The system is ready to switch to the new version
        this.tractor.emitTelemetry({
          event: "system:update_ready",
          payload: { message: "Refresh to apply sovereign updates." }
        });
      });

      navigator.serviceWorker.ready.then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Background download complete
                this.tractor.emitTelemetry({
                  event: "system:update_available",
                  payload: { version: "pending" }
                });
              }
            });
          }
        });
      });
    }
  }

  public announce() {
    const primary = "color: #2e7d32; font-weight: bold; font-size: 1.2rem;";
    const accent = "color: #ff9800; font-weight: bold;";
    const muted = "color: #757575;";

    console.log(
      `%c\n` +
      `  ██████╗ ███████╗███████╗ █████╗ ██████╗ ███╗   ███╗\n` +
      `  ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗████╗ ████║\n` +
      `  ██████╔╝█████╗  █████╗  ███████║██████╔╝██╔████╔██║\n` +
      `  ██╔══██╗██╔══╝  ██╔══╝  ██╔══██║██╔══██╗██║╚██╔╝██║\n` +
      `  ██║  ██║███████╗██║     ██║  ██║██║  ██║██║ ╚═╝ ██║\n` +
      `  ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝\n` +
      `%c\n` +
      `  Refarm Engine v${Tractor.VERSION} — Solo Fértil\n` +
      `  Sovereign Knowledge Infrastructure\n\n`,
      primary,
      muted
    );

    console.group("%cLoaded Capabilities", accent);
    if (this._logs.length === 0) {
       console.log("%c  (no external plugins loaded)", muted);
    } else {
       this._logs.forEach(l => console.log(l));
    }
    console.groupEnd();
    console.log("\n");
  }
}
