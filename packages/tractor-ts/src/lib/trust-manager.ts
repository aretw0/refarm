import { PluginManifest } from "@refarm.dev/plugin-manifest";
import { TelemetryEvent } from "./telemetry";

export interface PluginTrustGrant {
  pluginId: string;
  wasmHash: string;
  grantedAt: number;
  expiresAt?: number;
}

export type ExecutionProfile = "strict" | "trusted-fast";

/**
 * Manages plugin trust grants and execution profiles.
 */
export class TrustManager {
  private readonly trustGrants: Map<string, PluginTrustGrant> = new Map();

  constructor(private emit: (data: TelemetryEvent) => void) {}

  private getTrustKey(pluginId: string, wasmHash: string): string {
    return `${pluginId}::${wasmHash}`;
  }

  hasValidTrustGrant(pluginId: string, wasmHash?: string): boolean {
    if (!wasmHash) return false;
    const key = this.getTrustKey(pluginId, wasmHash);
    const grant = this.trustGrants.get(key);
    if (!grant) return false;
    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      this.trustGrants.delete(key);
      return false;
    }
    return true;
  }

  resolveExecutionProfile(
    manifest: PluginManifest,
    wasmHash?: string,
  ): ExecutionProfile {
    const trust = (
      manifest as PluginManifest & { trust?: { profile?: ExecutionProfile } }
    ).trust;
    const requestedProfile: ExecutionProfile = trust?.profile ?? "strict";
    if (requestedProfile !== "trusted-fast") {
      return "strict";
    }

    return this.hasValidTrustGrant(manifest.id, wasmHash)
      ? "trusted-fast"
      : "strict";
  }

  grantTrust(
    pluginId: string,
    wasmHash: string,
    leaseMs?: number,
  ): PluginTrustGrant {
    const now = Date.now();
    const grant: PluginTrustGrant = {
      pluginId,
      wasmHash,
      grantedAt: now,
      expiresAt: leaseMs ? now + leaseMs : undefined,
    };
    this.trustGrants.set(this.getTrustKey(pluginId, wasmHash), grant);
    this.emit({
      event: "plugin:trust_granted",
      pluginId,
      payload: {
        wasmHash,
        expiresAt: grant.expiresAt,
      },
    });
    return grant;
  }

  trustManifestOnce(
    manifest: PluginManifest,
    wasmHash: string,
  ): PluginTrustGrant {
    const trust = (
      manifest as PluginManifest & { trust?: { leaseHours?: number } }
    ).trust;
    const leaseMs = trust?.leaseHours
      ? trust.leaseHours * 60 * 60 * 1000
      : undefined;
    return this.grantTrust(manifest.id, wasmHash, leaseMs);
  }

  revokeTrust(pluginId: string, wasmHash?: string): void {
    if (wasmHash) {
      this.trustGrants.delete(this.getTrustKey(pluginId, wasmHash));
    } else {
      for (const key of this.trustGrants.keys()) {
        if (key.startsWith(`${pluginId}::`)) {
          this.trustGrants.delete(key);
        }
      }
    }
    this.emit({
      event: "plugin:trust_revoked",
      pluginId,
      payload: { wasmHash },
    });
  }

  getGrantsForPlugin(pluginId: string): PluginTrustGrant[] {
    const prefix = `${pluginId}::`;
    const grants: PluginTrustGrant[] = [];
    for (const [key, grant] of this.trustGrants.entries()) {
      if (key.startsWith(prefix)) {
        grants.push(grant);
      }
    }
    return grants;
  }
}
