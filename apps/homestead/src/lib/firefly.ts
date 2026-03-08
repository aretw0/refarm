import { Tractor } from "@refarm.dev/tractor";

/**
 * Firefly Plugin (O Vagalume)
 * 
 * Responsible for system-wide presence and guidance UI.
 * - Global Notifications (Toasts)
 * - Spotlight (Element focus for tutorials)
 */
export class FireflyPlugin {
  constructor(private tractor: Tractor) {
    this.setupListeners();
    this.injectStyles();
  }

  private setupListeners() {
    this.tractor.observe((data) => {
      // Listen for system alerts
      if (data.event === "system:alert") {
        this.showToast(data.payload?.reason || "System Alert", data.payload?.severity === "error");
      }

      // Listen for update notifications (wired by Herald)
      if (data.event === "system:update_available") {
        this.showToast("A new sovereign update is being prepared...");
      }

      if (data.event === "system:update_ready") {
        this.showToast("Update ready. Cultivate now?", true);
      }

      // Listen for guidance/spotlight events
      if (data.event === "system:guidance" && data.payload?.targetId) {
        this.spotlight(data.payload.targetId, data.payload.message);
      }
    });
  }

  private injectStyles() {
    if (document.getElementById("refarm-firefly-styles")) return;

    const style = document.createElement("style");
    style.id = "refarm-firefly-styles";
    style.textContent = `
      @keyframes slideInUp {
        from { transform: translateY(100%) scale(0.95); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @keyframes pulseFirefly {
        0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4); }
        70% { box-shadow: 0 0 0 10px rgba(76, 175, 80, 0); }
        100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); }
      }
      .firefly-toast {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: var(--refarm-bg-elevated, #222);
        color: var(--refarm-text-primary, #fff);
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        border: 1px solid var(--refarm-accent-primary, #4caf50);
        display: flex;
        align-items: center;
        gap: 1rem;
        z-index: 10000;
        animation: slideInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: var(--refarm-font-sans, sans-serif);
      }
      .firefly-spotlight-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7);
        z-index: 9998;
        pointer-events: none;
        transition: opacity 0.5s;
        opacity: 0;
      }
      .firefly-focused {
        position: relative;
        z-index: 9999 !important;
        box-shadow: 0 0 20px var(--refarm-accent-primary);
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  }

  public showToast(message: string, isActionable: boolean = false) {
    let toast = document.getElementById("refarm-firefly-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "refarm-firefly-toast";
      toast.className = "firefly-toast";
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <span style="font-size: 0.9rem; font-weight: 500;">${message}</span>
      ${isActionable ? `
        <button id="firefly-refresh" style="
          background: var(--refarm-accent-primary);
          color: white; border: none; padding: 0.5rem 1rem;
          border-radius: 8px; cursor: pointer; font-weight: 600;
          font-size: 0.8rem;
        ">Refresh</button>
      ` : `<div style="width:12px; height:12px; border:2px solid rgba(255,255,255,0.1); border-top-color:#fff; border-radius:50%; animation: spin 1s linear infinite;"></div>`}
    `;

    if (isActionable) {
      toast.querySelector("#firefly-refresh")?.addEventListener("click", () => {
        window.location.reload();
      });
    } else {
      setTimeout(() => {
        toast?.remove();
      }, 5000);
    }
  }

  public spotlight(targetId: string, message?: string) {
    const target = document.getElementById(targetId);
    if (!target) return;

    let overlay = document.getElementById("firefly-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "firefly-overlay";
      overlay.className = "firefly-spotlight-overlay";
      document.body.appendChild(overlay);
    }

    // Activate spotlight
    overlay.style.opacity = "1";
    target.classList.add("firefly-focused");

    if (message) {
      this.showToast(message);
    }

    // Return a function to clear spotlight
    return () => {
      overlay?.remove();
      target.classList.remove("firefly-focused");
    };
  }
}
