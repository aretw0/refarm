import { CommandHost } from "./command-host";
import { EventEmitter, TelemetryEvent } from "./telemetry";

const SAS_EMOJIS = [
  "🐶", "🐱", "🦁", "🐯", "🦒", "🦊", "🦝", "🐮", "🐷", "🐭",
  "🐹", "🐰", "🐻", "🐨", "🐼", "🐸", "🦓", "🐴", "🦄", "🐲",
  "🦖", "🐢", "🐍", "🐙", "🦑", "🦐", "🦀", "🐬", "🐳", "🦈",
  "🐡", "🐠", "🦋", "🐝", "🐞", "🐜", "🦗", "🕷️", "🦂", "🦟",
  "🦠", "🌻", "🌼", "🌽", "🌾", "🌿", "🍀", "🍁", "🍄", "🥓",
  "🥨", "🧀", "🥞", "🍳", "🥖", "🥐", "🌭", "🍔", "🍟", "🍕",
  "🥗", "🥘", "🥪", "🌮"
];

/**
 * Implements Tiered Security Protocol:
 * - Gold: Hardware keys (Passkeys/WebAuthn)
 * - Silver: Password-derived keys (E2EE)
 * - Bronze: Pure Session (In-Memory Only)
 */
export interface SecretAuthPrompt {
  title: string;
  hint?: string;
  tier: "gold" | "silver" | "bronze";
}

export type AuthResponse = { success: boolean; key?: CryptoKey };

export interface SecretHostLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

function resolveDefaultLogger(): SecretHostLogger {
  const env = (globalThis as any)?.process?.env as Record<string, string | undefined> | undefined;
  if (env?.VITEST === "true" || env?.NODE_ENV === "test") {
    return { info: () => {}, warn: () => {}, debug: () => {} };
  }
  return console;
}

export class SecretHost {
  private _sessionKeys: Map<string, CryptoKey> = new Map();
  private emit?: (data: TelemetryEvent) => void;

  constructor(
    private onAuthRequest: (prompt: SecretAuthPrompt) => Promise<AuthResponse>,
    private logger: SecretHostLogger = resolveDefaultLogger(),
  ) {}

  register(events: EventEmitter, commands: CommandHost) {
    this.emit = (data: TelemetryEvent) => events.emit(data);

    commands.register({
      id: "system:security:verify-device",
      title: "Verify New Device",
      category: "Security",
      description: "Start SAS (Emoji) verification for a new device.",
      handler: async () => {
        const sas = this.generateSasEmojis();
        this.emit?.({
          event: "security:verification_start",
          payload: { method: "sas", emojis: sas },
        });
        return { sas };
      },
    });

    commands.register({
      id: "system:security:confirm-sas",
      title: "Confirm Security Code",
      category: "Security",
      handler: async (args: { confirmed: boolean }) => {
        this.emit?.({
          event: "security:verification_result",
          payload: { method: "sas", success: args.confirmed },
        });
        return { success: args.confirmed };
      },
    });
  }

  private generateSasEmojis(count: number = 7): string[] {
    const emojis: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * SAS_EMOJIS.length);
      emojis.push(SAS_EMOJIS[idx]);
    }
    return emojis;
  }

  /**
   * Purges all unwrapped keys from memory.
   * This is the "Auto-Lock" safety mechanism for Guest and Normal modes.
   */
  async lock(): Promise<void> {
    this.logger.info(
      "[secret-host] Executing Auto-Lock. Purging session keys...",
    );
    this._sessionKeys.clear();
  }

  /**
   * Unlocks a SovereignSecret node using the appropriate fallback tier.
   */
  async decryptSecret(encryptedBlob: any): Promise<string | null> {
    const { tier, hint } = encryptedBlob;

    this.logger.info(`[secret-host] Requesting unlock for tier: ${tier}`);

    // Call the Shell's UI via the auth request callback
    const response = await this.onAuthRequest({
      title: `Unlock Secret`,
      hint: hint || "Refarm is requesting access to a secured hardware key.",
      tier,
    });

    if (!response.success || !response.key) {
      this.logger.warn(`[secret-host] Unlock failed or denied by user.`);
      return null;
    }

    // Placeholder for actual JWE decryption using the derived CryptoKey
    // In a real implementation, we would use crypto.subtle.decrypt
    this.logger.debug(`[secret-host] Decrypting payload with ${tier} key...`);

    // Mock successful decryption
    return "decrypted-secret-value-placeholder";
  }

  /**
   * Anchors a new secret to the hardware enclave or password.
   */
  async createSecret(value: string, tier: "gold" | "silver"): Promise<any> {
    // 1. Request a key (from Hardware or Password)
    const response = await this.onAuthRequest({
      title: `Create Sovereign Secret`,
      tier,
    });

    if (!response.success || !response.key)
      throw new Error("Key creation denied.");

    // 2. Encrypt the value (Mock JWE creation)
    return {
      "@type": "SovereignSecret",
      tier: tier,
      jwe: {
        ciphertext: "mock-encrypted-data",
        tag: "mock-tag",
      },
      timestamp: new Date().toISOString(),
    };
  }
}
