import { describe, expect, it, vi, beforeEach } from "vitest";
import { SecretHost, SecretAuthPrompt, AuthResponse } from "../src/lib/secret-host";
import { EventEmitter } from "../src/lib/telemetry";
import { CommandHost } from "../src/lib/command-host";

describe("SecretHost", () => {
  let secretHost: SecretHost;
  let mockOnAuthRequest: (prompt: SecretAuthPrompt) => Promise<AuthResponse>;
  let mockEventEmitter: EventEmitter;
  let mockCommandHost: CommandHost;

  beforeEach(() => {
    mockOnAuthRequest = vi.fn().mockResolvedValue({ success: true, key: {} as CryptoKey });
    secretHost = new SecretHost(mockOnAuthRequest);
    mockEventEmitter = new EventEmitter();
    mockCommandHost = new CommandHost(vi.fn());
    secretHost.register(mockEventEmitter, mockCommandHost);
  });

  it("registers security commands", () => {
    expect(mockCommandHost.get("system:security:verify-device")).toBeDefined();
    expect(mockCommandHost.get("system:security:confirm-sas")).toBeDefined();
  });

  it("handles verify-device command and generates SAS emojis", async () => {
    const command = mockCommandHost.get("system:security:verify-device");
    const result = await command?.handler();
    
    expect(result.sas).toHaveLength(7);
    expect(Array.isArray(result.sas)).toBe(true);
  });

  it("handles confirm-sas command", async () => {
    const command = mockCommandHost.get("system:security:confirm-sas");
    const result = await command?.handler({ confirmed: true });
    
    expect(result.success).toBe(true);
  });

  it("locks and purges session keys", async () => {
    // We can't directly check the private _sessionKeys, but we can call lock
    await expect(secretHost.lock()).resolves.toBeUndefined();
  });

  it("decrypts a secret with user authorization", async () => {
    const encryptedBlob = { tier: "gold", hint: "Test Decrypt" };
    const result = await secretHost.decryptSecret(encryptedBlob);
    
    expect(mockOnAuthRequest).toHaveBeenCalledWith({
      title: "Unlock Secret",
      hint: "Test Decrypt",
      tier: "gold",
    });
    expect(result).toBe("decrypted-secret-value-placeholder");
  });

  it("fails decryption when user denies authorization", async () => {
    mockOnAuthRequest = vi.fn().mockResolvedValue({ success: false });
    secretHost = new SecretHost(mockOnAuthRequest);
    
    const encryptedBlob = { tier: "gold" };
    const result = await secretHost.decryptSecret(encryptedBlob);
    
    expect(result).toBeNull();
  });

  it("creates a new secret after user authorization", async () => {
    const result = await secretHost.createSecret("top-secret", "silver");
    
    expect(mockOnAuthRequest).toHaveBeenCalledWith({
      title: "Create Sovereign Secret",
      tier: "silver",
    });
    expect(result["@type"]).toBe("SovereignSecret");
    expect(result.tier).toBe("silver");
    expect(result.jwe).toBeDefined();
  });

  it("fails to create secret when user denies authorization", async () => {
    mockOnAuthRequest = vi.fn().mockResolvedValue({ success: false });
    secretHost = new SecretHost(mockOnAuthRequest);
    
    await expect(secretHost.createSecret("top-secret", "gold")).rejects.toThrow("Key creation denied.");
  });
});
