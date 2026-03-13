import { L8nHost, Tractor, type SovereignNode, type TelemetryEvent } from "@refarm.dev/tractor";
import { A11yGuard } from "./A11yGuard.js";

import en from "@refarm.dev/locales/en.json";
import ptBR from "@refarm.dev/locales/pt-BR.json";

export interface ShellSlot {
  id: string;
  element: HTMLElement;
}

/**
 * The StudioShell is the orchestrator for the Homestead UI.
 * It maps plugins to DOM slots and manages their lifecycle in the browser.
 */
export class StudioShell {
  private l8n: L8nHost;
  private slots: Map<string, HTMLElement> = new Map();

  constructor(private tractor: Tractor) {
    this.l8n = new L8nHost();
    this.setupL8n();
    this.discoverSlots();
  }

  private setupL8n() {
    // 1. Detect Browser Locale
    const locale = navigator.language.split('-')[0] || 'en';
    this.l8n.setLocale(locale);

    // 2. Register Bootloader Bundle (PT/EN)
    this.l8n.registerKeys('refarm:core', en);

    if (locale === 'pt') {
      this.l8n.registerKeys('refarm:core', ptBR);
    }
  }

  private shouldLog(level: "info" | "warn" | "error"): boolean {
    const priority = { silent: 0, error: 1, warn: 2, info: 3 };
    return priority[this.tractor.logLevel] >= priority[level];
  }

  private logInfo(...args: unknown[]): void {
    if (this.shouldLog("info")) console.info(...args);
  }

  private logWarn(...args: unknown[]): void {
    if (this.shouldLog("warn")) console.warn(...args);
  }

  private logError(...args: unknown[]): void {
    if (this.shouldLog("error")) console.error(...args);
  }

  private discoverSlots() {
    const slotElements = document.querySelectorAll('.slot');
    slotElements.forEach((el: Element) => {
      const htmlEl = el as HTMLElement;
      const id = htmlEl.id.replace('refarm-slot-', '');
      this.slots.set(id, htmlEl);
    });
    this.logInfo("[shell] Slots discovered:", Array.from(this.slots.keys()));
  }

  /**
   * Orchestrates the boot sequence.
   */
  async setup() {
    A11yGuard.applySaneDefaults(document.body);
    this.updateStatus(this.l8n.t("refarm:core/loading"));
    
    // Listen for system events
    this.tractor.observe((data: TelemetryEvent) => {
      if (data.event === "system:switch-tier") {
        const tier = data.payload?.tier;
        this.logInfo(`[shell] Mode switch detected: ${tier}. Persisting and reloading...`);
        localStorage.setItem('refarm:mode', tier);
        window.location.reload();
      }

      if (data.event === "system:plugin_state_changed") {
        const pluginId = data.pluginId;
        const state = data.payload?.state;
        const selector = `.plugin-${pluginId?.replace(/[^a-z0-9]/g, '-')}`;
        const el = document.querySelector(selector) as HTMLElement;
        
        if (el && state) {
          this.logInfo(`[shell] Reflection: Plugin ${pluginId} moved to state: ${state}`);
          el.setAttribute("data-refarm-state", state);
        }
      }
    });

    // 1. Check for active UI plugins
    const apps = this.tractor.plugins.getAllPlugins();
    let hasUi = false;
    
    for (const plugin of apps) {
      if (plugin.manifest.ui?.slots) {
        hasUi = true;
        for (const slotId of plugin.manifest.ui.slots) {
          await this.injectPluginIntoSlot(plugin.id, slotId);
        }
      }
    }

    // 2. If no UI plugins, trigger "Experience Mode" (System Help)
    if (!hasUi) {
      await this.renderSystemHelp();
    }

    this.updateStatus(this.l8n.t("refarm:core/status_ready"));
  }

  private async renderSystemHelp() {
    const mainSlot = this.slots.get("main");
    if (!mainSlot) return;

    const helpNodes = await this.tractor.getHelpNodes();
    const seedNode = helpNodes.find((n: SovereignNode) => n["refarm:renderType"] === "landing") || helpNodes[0];

    if (seedNode["refarm:renderType"] === "landing") {
      mainSlot.innerHTML = `
        <div class="visitor-landing" style="max-width: 900px; margin: 4rem auto; text-align: center; animation: fadeInUp 0.8s ease-out;">
          <h1 style="font-size: 4rem; font-weight: 800; background: var(--refarm-accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1.5rem;">
            ${seedNode.name}
          </h1>
          <p style="font-size: 1.5rem; color: var(--refarm-text-secondary); line-height: 1.6; margin-bottom: 3rem;">
            ${seedNode.text}
          </p>
          
          <div class="landing-actions" style="display: flex; gap: 1.5rem; justify-content: center;">
            <a href="${(import.meta as any).env?.BASE_URL || "/"}onboarding" class="btn-primary" style="padding: 1rem 2.5rem; background: var(--refarm-accent-primary); color: white; border-radius: 50px; text-decoration: none; font-weight: 600; box-shadow: var(--refarm-shadow-lg);">
              Cultivate your soil
            </a>
            <button id="try-guest-mode" class="btn-secondary" style="padding: 1rem 2.5rem; background: transparent; color: var(--refarm-text-primary); border: 2px solid var(--refarm-border-default); border-radius: 50px; font-weight: 600; cursor: pointer;">
              Try Guest Mode
            </button>
          </div>

          <div class="semantic-preview" style="margin-top: 6rem; text-align: left; padding: 2rem; border-radius: 20px; background: rgba(0,0,0,0.03); border: 1px dashed var(--refarm-border-default);">
            <small style="text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.5;">Sovereign Node Raw Data</small>
            <pre style="margin-top: 1rem; font-size: 0.8rem; color: var(--refarm-accent-secondary); overflow: auto;">${JSON.stringify(seedNode, null, 2)}</pre>
          </div>
        </div>
      `;

      // Wire up Guest Mode button (Insight "Divisor de Águas")
      mainSlot.querySelector("#try-guest-mode")?.addEventListener("click", () => {
        window.location.href = `${(import.meta as any).env?.BASE_URL || "/"}onboarding?mode=guest`;
      });

      return;
    }

    if (seedNode["refarm:renderType"] === "onboarding") {
      const options = (seedNode["refarm:options"] as any[]) || [];
      mainSlot.innerHTML = `
        <div class="onboarding-flow" style="max-width: 700px; margin: 4rem auto; animation: fadeIn 0.5s;">
          <h1 style="font-size: 2.5rem; margin-bottom: 1rem;">${seedNode.name}</h1>
          <p style="color: var(--refarm-text-secondary); margin-bottom: 3rem;">${seedNode.description || seedNode.text}</p>
          
          <div class="options-grid" style="display: grid; gap: 1.5rem;">
            ${options.map(opt => `
              <div class="option-card" style="padding: 2rem; border: 1px solid var(--refarm-border-default); border-radius: 20px; cursor: pointer; transition: all 0.2s;" data-intent="${opt.intent}">
                <h3 style="color: var(--refarm-accent-primary); margin-bottom: 0.5rem;">${opt.label}</h3>
                <p style="font-size: 0.9rem; opacity: 0.8;">${opt.description}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      mainSlot.querySelectorAll(".option-card").forEach((el: Element) => {
        const card = el as HTMLElement;
        card.addEventListener("click", () => {
          const intent = card.getAttribute("data-intent");
          if (intent === "switch-to-guest") this.tractor.switchTier("guest");
          if (intent === "switch-to-citizen") this.tractor.switchTier("citizen");
        });
      });

      return;
    }

    // Fallback if no landing/onboarding node
    mainSlot.innerHTML = `
      <div class="system-help-explorer" style="max-width: 800px; margin: 0 auto;">
        <h1 style="font-size: 2.5rem; margin-bottom: 2rem; background: var(--refarm-accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          ${this.l8n.t("refarm:core/welcome")}
        </h1>
        <div class="help-grid" style="display: grid; gap: 1.5rem;">
          ${helpNodes.map((node: SovereignNode) => `
            <div class="help-card" style="padding: 1.5rem; border: 1px solid var(--refarm-border-default); border-radius: 12px; background: var(--refarm-bg-secondary);">
              <h3 style="margin-bottom: 0.5rem; color: var(--refarm-accent-primary);">${node.name}</h3>
              <p style="font-size: 0.9rem; color: var(--refarm-text-secondary);">${node.text}</p>
              <small style="display: block; margin-top: 1rem; opacity: 0.5;">Source: ${node["refarm:sourcePlugin"]}</small>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private async injectPluginIntoSlot(pluginId: string, slotId: string) {
    const container = this.slots.get(slotId);
    if (!container) {
      this.logWarn(`[shell] Slot ${slotId} not found for plugin ${pluginId}`);
      return;
    }

    // Clear default content if this is the first plugin
    if (container.children.length === 0 || container.querySelector('a[href]')) {
      container.innerHTML = '';
    }

    const pluginWrap = document.createElement('div');
    const pluginIdSanitized = pluginId.replace(/[^a-z0-9]/g, '-');
    pluginWrap.className = `plugin-view plugin-${pluginIdSanitized}`;
    
    // Initial State Reflection
    const plugin = this.tractor.plugins.get(pluginId);
    if (plugin) {
      pluginWrap.setAttribute("data-refarm-state", plugin.state || "running");
    }

    container.appendChild(pluginWrap);

    // Monitoring: Convert DOM pulse to telemetry
    A11yGuard.monitorElement(pluginWrap, (velocity: number) => {
      this.tractor.emitTelemetry({
        event: "ui:performance",
        pluginId,
        payload: { updateVelocity: velocity, slotId }
      });
    });

    try {
      const plugin = this.tractor.plugins.get(pluginId);
      
      // Automatic i18n Registration
      if (plugin?.manifest.i18n) {
        const bundle = plugin.manifest.i18n;
        const locale = this.l8n.getLocale();
        
        if (typeof bundle === 'object') {
          const keys = bundle[locale] || bundle['en'] || bundle;
          this.l8n.registerKeys(pluginId, keys);
        } else if (typeof bundle === 'string') {
          // Future: Fetch remote bundle
          this.logInfo(`[shell] Plugin ${pluginId} defines remote i18n: ${bundle}`);
        }
      }

      const api = await this.tractor.getPluginApi(`${pluginId}:ui`);
      if (api) {
        pluginWrap.innerHTML = `<small>Plugin ${pluginId} active in ${slotId}</small>`;
      }
    } catch (e) {
      this.logError(`[shell] Failed to render plugin ${pluginId}`, e);
    }
  }

  private updateStatus(text: string) {
    const statusEl = document.getElementById("system-status");
    if (statusEl) statusEl.textContent = text;
  }
}
