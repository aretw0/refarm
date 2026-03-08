/**
 * L8nHost — Sovereign Internationalization Machinery.
 * 
 * Implements namespaced translation keys with inheritance:
 * - "refarm:core/save" -> Core terminology correctly localized.
 * - "plugin-id:welcome" -> Plugin-specific terminology.
 */
export class L8nHost {
  private _namespaces: Map<string, Record<string, string>> = new Map();
  private _currentLocale: string = 'en';

  constructor() {
    this.setupCore();
  }

  private setupCore() {
    // Initial core keys (fallback before Graph load)
    this._namespaces.set('refarm:core', {
      'save': 'Save',
      'cancel': 'Cancel',
      'loading': 'Loading...',
      'status_ready': 'Ready',
      'unlocked': 'Unlocked'
    });
  }

  /**
   * Sets the current locale and triggers a reactive update.
   */
  setLocale(locale: string) {
    this._currentLocale = locale;
    console.info(`[l8n] Locale changed to: ${locale}`);
  }

  /**
   * Register translation keys for a specific namespace.
   */
  registerKeys(namespace: string, keys: Record<string, string>) {
    const existing = this._namespaces.get(namespace) || {};
    this._namespaces.set(namespace, { ...existing, ...keys });
  }

  /**
   * The primary translation function.
   * Handles:
   * 1. Namespace lookup (p:key or p/key)
   * 2. Core inheritance (if no namespace supplied)
   * 3. Fallback to key itself
   */
  t(key: string, params?: Record<string, string>): string {
    let ns = 'refarm:core';
    let k = key;

    if (key.includes(':')) {
      const parts = key.split(':');
      ns = parts[0];
      k = parts[1];
    } else if (key.includes('/')) {
      // Support "refarm:core/save" or "plugin/key"
      const parts = key.split('/');
      ns = parts[0];
      k = parts[1];
    }

    // Special case for "refarm:core" as it contains a colon
    if (key.startsWith('refarm:core/')) {
      ns = 'refarm:core';
      k = key.replace('refarm:core/', '');
    }

    const bundle = this._namespaces.get(ns);
    let value = bundle ? bundle[k] : null;

    // Fallback to core if not found in plugin namespace
    if (!value && ns !== 'refarm:core') {
      value = this._namespaces.get('refarm:core')?.[k] || null;
    }

    if (!value) return key; // Return raw key as ultimate fallback

    // Simple param replacement
    if (params) {
      Object.entries(params).forEach(([p, v]) => {
        value = value!.replace(`{${p}}`, v);
      });
    }

    return value!;
  }

  get currentLocale() {
    return this._currentLocale;
  }
}
