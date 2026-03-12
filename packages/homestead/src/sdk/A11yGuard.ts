/// <reference lib="dom" />
/**
 * A11y Guard — Protection for users against "Gremlin" plugins.
 * 
 * Moved out of Tractor core to Homestead Shell (lib) to maintain
 * engine agnosticism.
 */
export class A11yGuard {
  /**
   * Enforces global sane defaults.
   */
  static applySaneDefaults(root: HTMLElement) {
    const style = document.createElement('style');
    style.id = 'refarm-a11y-defaults';
    style.textContent = `
      /* Strobe/Seizure Protection - Dampen extreme transitions by default */
      * {
        transition-duration: 0.2s !important;
        animation-duration: 0.3s !important;
      }
      
      /* Accessibility Focus */
      :focus-visible {
        outline: 3px solid var(--color-primary, #6366f1) !important;
        outline-offset: 2px !important;
      }
    `;
    root.appendChild(style);
  }

  /**
   * Creates a monitor for DOM mutations to calculate update velocity.
   * Useful for detecting "Gremlin" plugins that spam the DOM.
   */
  static monitorElement(el: HTMLElement, onVelocityChange: (velocity: number) => void): MutationObserver {
    let count = 0;
    let lastCheck = performance.now();

    const observer = new MutationObserver((mutations) => {
      count += mutations.length;
      const now = performance.now();
      const elapsed = now - lastCheck;

      if (elapsed >= 1000) {
        const velocity = Math.round((count * 1000) / elapsed);
        onVelocityChange(velocity);
        count = 0;
        lastCheck = now;
      }
    });

    observer.observe(el, { attributes: true, childList: true, subtree: true });
    return observer;
  }
}
