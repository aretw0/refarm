/**
 * Refarm Terminal Plugin
 * 
 * Provides a shared output area for the system.
 */

export interface OutputApi {
  log(message: string, level?: 'info' | 'warn' | 'error' | 'debug'): void;
  clear(): void;
}

export class TerminalPlugin {
  private _logs: string[] = [];
  private _el: HTMLElement | null = null;

  constructor() {
    console.info("[terminal-plugin] Initialized");
  }

  // --- Integration Hooks ---

  async setup(): Promise<void> {
    this._el = document.createElement('div');
    this._el.className = 'refarm-card refarm-mono';
    this._el.style.cssText = `
      height: 300px;
      overflow-y: auto;
      background: var(--refarm-bg-primary);
      color: var(--refarm-success);
      font-size: 0.85rem;
      padding: 1rem;
    `;
    document.body.appendChild(this._el);
    this.log("System Terminal Online", "info");
  }

  async ingest(): Promise<number> {
    return 0; // Terminal is a passive consumer
  }

  async teardown(): Promise<void> {
    this._el?.remove();
  }

  // --- Exported API (OutputApi) ---

  log(message: string, level: string = 'info'): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    this._logs.push(entry);
    
    if (this._el) {
      const line = document.createElement('div');
      line.textContent = entry;
      if (level === 'error') line.style.color = 'var(--refarm-error)';
      if (level === 'warn') line.style.color = 'var(--refarm-warning)';
      this._el.appendChild(line);
      this._el.scrollTop = this._el.scrollHeight;
    }
  }

  clear(): void {
    this._logs = [];
    if (this._el) this._el.innerHTML = '';
  }

  metadata() {
    return {
      name: "Refarm Terminal",
      version: "0.1.0",
      description: "Standardised output for plugins",
      supportedTypes: [],
      requiredCapabilities: []
    };
  }
}
