import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { describe, expect, it, vi } from "vitest";
import { SecretHost, Tractor } from "../src/index";
import {
  summarizeRuntimeDescriptorRevocationTelemetry,
  TelemetryRingBuffer,
} from "../src/lib/telemetry";

describe("Tractor Telemetry", () => {
  const mockStorage: StorageAdapter = {
    ensureSchema: vi.fn(),
    storeNode: vi.fn(),
    queryNodes: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  } as any;

  const mockIdentity: IdentityAdapter = {
    getSigningPublicKey: vi.fn().mockResolvedValue("pubkey"),
  } as any;

  it("should emit telemetry when a node is stored", async () => {
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity, namespace: "test-telemetry-io" });
    const listener = vi.fn();
    tractor.observe(listener);

    await tractor.storeNode({
      "@context": "https://schema.org/",
      "@type": "TestNode",
      "@id": "urn:test:1",
      "refarm:sourcePlugin": "test-plugin"
    }, "none");

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      event: "storage:io",
      pluginId: "test-plugin",
      payload: expect.objectContaining({ action: "store", type: "TestNode" })
    }));
  });

  it("should emit telemetry when a plugin is loaded", async () => {
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity, namespace: "test-telemetry-load" });
    const listener = vi.fn();
    tractor.observe(listener);

    // Mock fetch for wasm
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
    });

    const manifest = {
      id: "hello-world",
      name: "Hello World",
      entry: "https://example.com/plugin.wasm",
      capabilities: {}
    } as any;
    await tractor.registry.register(manifest);
    const entry = tractor.registry.getPlugin("hello-world");
    if (entry) entry.status = "validated";

    await tractor.plugins.load(manifest);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      event: "plugin:load",
      pluginId: "hello-world"
    }));
  });

  it("should handle secret decryption with auth provider", async () => {
    const onAuthRequest = vi.fn().mockResolvedValue({ success: true, key: { mock: true } });
    const tractor = await Tractor.boot({
      storage: mockStorage,
      identity: mockIdentity,
      namespace: "test-telemetry-secret"
    });

    const secrets = new SecretHost(onAuthRequest);

    const mockSecretBlob = {
      "@type": "SovereignSecret",
      "tier": "gold",
      "jwe": { ciphertext: "..." }
    };

    const result = await secrets.decryptSecret(mockSecretBlob);
    
    expect(onAuthRequest).toHaveBeenCalledWith(expect.objectContaining({
      tier: "gold"
    }));
    expect(result).toBe("decrypted-secret-value-placeholder");
  });

  it("should return null if user denies secret decryption", async () => {
    const onAuthRequest = vi.fn().mockResolvedValue({ success: false });
    const tractor = await Tractor.boot({
      storage: mockStorage,
      identity: mockIdentity,
      namespace: "test-telemetry-deny"
    });

    const secrets = new SecretHost(onAuthRequest);

    const result = await secrets.decryptSecret({ tier: "gold" });
    expect(result).toBeNull();
  });
});

describe("TelemetryRingBuffer", () => {
  it("should respect maximum capacity and overwrite oldest events", () => {
    const ring = new TelemetryRingBuffer({ capacity: 3 });
    
    ring.push({ event: "event_1" });
    ring.push({ event: "event_2" });
    ring.push({ event: "event_3" });
    ring.push({ event: "event_4" });

    const dumped = ring.dump();
    expect(dumped.length).toBe(3);
    // event_1 should be evicted
    expect(dumped[0].event).toBe("event_2");
    expect(dumped[1].event).toBe("event_3");
    expect(dumped[2].event).toBe("event_4");
  });

  it("should sanitize strict sensitive keys during dump", () => {
    const ring = new TelemetryRingBuffer({ capacity: 10, sensitiveKeys: ["secret", "password"] });
    
    ring.push({
      event: "auth",
      payload: {
        username: "solofertil",
        secret: "my_super_secret",
        password: "my_password",
        publicData: "visible"
      }
    });

    const dumped = ring.dump();
    const payload = dumped[0].payload;

    expect(payload.secret).toBe("[REDACTED]");
    expect(payload.password).toBe("[REDACTED]");
    expect(payload.username).toBe("solofertil");
    expect(payload.publicData).toBe("visible");
  });

  it("should truncate long strings", () => {
    const ring = new TelemetryRingBuffer({ capacity: 10, maxValueLength: 10 });
    
    ring.push({
      event: "data",
      payload: { short: "abc", long: "this_is_a_very_long_string_indeed" }
    });

    const dumped = ring.dump();
    const payload = dumped[0].payload;

    expect(payload.short).toBe("abc");
    expect(payload.long).toBe("this_is_a_... [TRUNCATED]");
  });

  it("should format binary and array types appropriately", () => {
    const ring = new TelemetryRingBuffer({ capacity: 10 });
    
    ring.push({
      event: "binary",
      payload: {
        bytes: new Uint8Array(2048),
        bigArray: new Array(100).fill(1),
        smallArray: [1, 2, 3]
      }
    });

    const dumped = ring.dump();
    const payload = dumped[0].payload;

    expect(payload.bytes).toBe("[Uint8Array(2048)]");
    expect(payload.bigArray).toBe("[Array(100)]");
    expect(payload.smallArray).toEqual([1, 2, 3]);
  });

  it("should summarize runtime descriptor revocation telemetry events", () => {
    const summary = summarizeRuntimeDescriptorRevocationTelemetry([
      {
        event: "system:descriptor_revocation_unavailable",
        pluginId: "@acme/plugin-a",
        payload: {
          policy: "fail-open",
          policySource: "environment-profile",
          profile: "dev",
        },
      },
      {
        event: "system:descriptor_revocation_config_invalid",
        pluginId: "@acme/plugin-a",
        payload: {
          resolvedPolicy: "stale-allowed",
          policySource: "fallback",
        },
      },
      {
        event: "system:descriptor_revocation_config_conflict",
        pluginId: "@acme/plugin-b",
        payload: {
          resolvedPolicy: "fail-open",
          policySource: "environment-profile",
          profile: "dev",
        },
      },
      {
        event: "storage:io",
        pluginId: "@acme/plugin-c",
        payload: { action: "store" },
      },
    ]);

    expect(summary.totalEvents).toBe(3);
    expect(summary.byEvent["system:descriptor_revocation_unavailable"]).toBe(1);
    expect(summary.byEvent["system:descriptor_revocation_config_invalid"]).toBe(1);
    expect(summary.byEvent["system:descriptor_revocation_config_conflict"]).toBe(1);
    expect(summary.byEvent["system:descriptor_revocation_stale_cache_used"]).toBe(0);
    expect(summary.byPolicy["fail-open"]).toBe(2);
    expect(summary.byPolicy["stale-allowed"]).toBe(1);
    expect(summary.byPolicySource["environment-profile"]).toBe(2);
    expect(summary.byPolicySource.fallback).toBe(1);
    expect(summary.byProfile.dev).toBe(2);
    expect(summary.affectedPlugins).toEqual([
      "@acme/plugin-a",
      "@acme/plugin-b",
    ]);
  });
});

describe("TelemetryHost", () => {
  it("should register correctly and capture core events", async () => {
    const mockStorage: any = { ensureSchema: vi.fn(), queryNodes: vi.fn().mockResolvedValue([]) };
    const mockIdentity: any = { getSigningPublicKey: vi.fn().mockResolvedValue("key") };
    
    const tractor = await Tractor.boot({ storage: mockStorage, identity: mockIdentity, namespace: "test-telemetry-host" });
    
    // Trigger an event (calling the Tractor wrapper, not the raw adapter)
    await tractor.queryNodes("Test");
    
    // The query should have emitted a storage:io event caught by the telemetry host relay in index.ts constructor
    const dump = await tractor.commands.execute("system:diagnostics:export");
    
    expect(dump.events.length).toBeGreaterThan(0);
    expect(dump.events.some((e: any) => e.event === "storage:io")).toBe(true);
  });

  it("should expose descriptor revocation summary command", async () => {
    const mockStorage: any = {
      ensureSchema: vi.fn(),
      queryNodes: vi.fn().mockResolvedValue([]),
    };
    const mockIdentity: any = {
      getSigningPublicKey: vi.fn().mockResolvedValue("key"),
    };

    const tractor = await Tractor.boot({
      storage: mockStorage,
      identity: mockIdentity,
      namespace: "test-telemetry-revocation-summary",
    });

    tractor.telemetry.push({
      event: "system:descriptor_revocation_unavailable",
      pluginId: "@acme/plugin-a",
      payload: {
        policy: "fail-open",
        policySource: "environment-profile",
        profile: "dev",
      },
    });

    const result = await tractor.commands.execute(
      "system:diagnostics:descriptor-revocation-summary",
    );

    expect(result.summary.totalEvents).toBe(1);
    expect(
      result.summary.byEvent["system:descriptor_revocation_unavailable"],
    ).toBe(1);
    expect(result.summary.affectedPlugins).toEqual(["@acme/plugin-a"]);
  });
});
