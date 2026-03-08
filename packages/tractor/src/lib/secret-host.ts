/**
 * Implements Tiered Security Protocol:
 * - Gold: Hardware keys (Passkeys/WebAuthn)
 * - Silver: Password-derived keys (E2EE)
 * - Bronze: Pure Session (In-Memory Only)
 */
export interface SecretAuthPrompt {
  title: string;
  hint?: string;
  tier: 'gold' | 'silver' | 'bronze';
}

export type AuthResponse = { success: boolean; key?: CryptoKey };

export class SecretHost {
  private _sessionKeys: Map<string, CryptoKey> = new Map();

  constructor(
    private onAuthRequest: (prompt: SecretAuthPrompt) => Promise<AuthResponse>
  ) {}

  /**
   * Purges all unwrapped keys from memory.
   * This is the "Auto-Lock" safety mechanism for Guest and Normal modes.
   */
  async lock(): Promise<void> {
    console.info("[secret-host] Executing Auto-Lock. Purging session keys...");
    this._sessionKeys.clear();
  }

  /**
   * Unlocks a SovereignSecret node using the appropriate fallback tier.
   */
  async decryptSecret(encryptedBlob: any): Promise<string | null> {
    const { tier, hint } = encryptedBlob;

    console.info(`[secret-host] Requesting unlock for tier: ${tier}`);

    // Call the Shell's UI via the auth request callback
    const response = await this.onAuthRequest({
      title: `Unlock Secret`,
      hint: hint || "Refarm is requesting access to a secured hardware key.",
      tier
    });

    if (!response.success || !response.key) {
      console.warn(`[secret-host] Unlock failed or denied by user.`);
      return null;
    }

    // Placeholder for actual JWE decryption using the derived CryptoKey
    // In a real implementation, we would use crypto.subtle.decrypt
    console.debug(`[secret-host] Decrypting payload with ${tier} key...`);

    // Mock successful decryption
    return "decrypted-secret-value-placeholder";
  }

  /**
   * Anchors a new secret to the hardware enclave or password.
   */
  async createSecret(value: string, tier: 'gold' | 'silver'): Promise<any> {
    // 1. Request a key (from Hardware or Password)
    const response = await this.onAuthRequest({
      title: `Create Sovereign Secret`,
      tier
    });

    if (!response.success || !response.key) throw new Error("Key creation denied.");

    // 2. Encrypt the value (Mock JWE creation)
    return {
      "@type": "SovereignSecret",
      "tier": tier,
      "jwe": {
        "ciphertext": "mock-encrypted-data",
        "tag": "mock-tag"
      },
      "timestamp": new Date().toISOString()
    };
  }
}
