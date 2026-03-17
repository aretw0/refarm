/**
 * @refarm.dev/silo — browser-safe entrypoint
 *
 * SiloCore's persistent storage relies on node:fs and the local ~/.refarm directory.
 * Methods that require the filesystem throw at call time.
 * Read-only or network operations degrade gracefully.
 */

const FS_ERROR =
  "[silo] Persistent token/identity storage requires the Node.js runtime " +
  "and cannot run in the browser.";

/**
 * Browser stub for SiloCore.
 *
 * - loadRemoteConfig(): works — uses fetch, available in browser
 * - loadTokens(): returns {} — no persistent storage in browser
 * - resolve(): returns empty Map — no env vars or stored tokens in browser
 * - saveTokens(), bootstrapIdentity(), saveIdentityMetadata(): throw
 */
export class SiloCore {
  constructor(_config = {}) {
    this.config = _config;
  }

  async saveTokens(_tokens) {
    throw new Error(FS_ERROR);
  }

  async loadTokens() {
    return {};
  }

  async loadRemoteConfig(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    this.config = { ...this.config, ...data };
    return { status: "success", strategy: data.strategy || "ephemeral" };
  }

  async resolve() {
    return new Map();
  }

  async provision(_targetType = "object") {
    return {};
  }

  async bootstrapIdentity() {
    throw new Error(FS_ERROR);
  }

  async saveIdentityMetadata(_metadata) {
    throw new Error(FS_ERROR);
  }

  toGitHubEnv(tokens) {
    return Object.entries(tokens)
      .map(([key, val]) => `${key}=${val}`)
      .join("\n");
  }
}

/**
 * Browser stub for KeyManager.
 */
export class KeyManager {
  constructor(_config = {}) {}

  async generateMasterKey() {
    throw new Error(FS_ERROR);
  }
}

export default SiloCore;
