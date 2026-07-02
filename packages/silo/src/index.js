import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export * from "./collect.js";

export const SILO_STORE_SCHEMA_VERSION = 1;
export const SILO_SECRET_PROTECTION_SCHEME = "local-plaintext-v1";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_SECRET_PROTECTION = Object.freeze({
    scheme: SILO_SECRET_PROTECTION_SCHEME,
    encrypted: false,
    atRest: "posix-owner-only",
    keySource: "none",
    upgradeTarget: "opaque-envelope-v1",
});
const PLANNED_SECRET_PROTECTION = Object.freeze([
    {
        scheme: "opaque-envelope-v1",
        encrypted: true,
        keySource: "@refarm.dev/heartwood",
        status: "planned",
    },
    {
        scheme: "hardware-backed-envelope-v1",
        encrypted: true,
        keySource: "passkey|secure-enclave|tpm|hsm",
        status: "planned",
    },
]);

function canApplyPosixModes() {
    return process.platform !== "win32";
}

function applyMode(targetPath, mode) {
    if (!canApplyPosixModes()) return;
    try {
        chmodSync(targetPath, mode);
    } catch {
        // Some filesystems ignore POSIX modes; storage remains usable.
    }
}

function cloneProtection(protection = DEFAULT_SECRET_PROTECTION) {
    return { ...protection };
}

function createSecretEnvelope(value) {
    return {
        value,
        protection: cloneProtection(),
    };
}

// Schemes this build can read as plaintext. Legacy bare strings and the
// local-plaintext envelope are readable; anything encrypted or carrying an
// unknown scheme is NOT, so a future OPAQUE/hardware store is never silently
// handed back as a raw value (ADR-077 forward-safety).
const READABLE_SECRET_SCHEMES = new Set([SILO_SECRET_PROTECTION_SCHEME]);

export class UnreadableSecretError extends Error {
    constructor(scheme) {
        super(
            `[Silo] secret is protected with "${scheme}", which this @refarm.dev/silo build ` +
                `cannot read; upgrade @refarm.dev/silo to a release that supports it.`,
        );
        this.name = "UnreadableSecretError";
        this.code = "SILO_SECRET_UNREADABLE";
        this.scheme = scheme;
    }
}

// Classify a stored secret entry against what this build can interpret.
// Returns { present, readable, value, scheme }. `value` is only set when the
// entry is both present and readable.
function classifySecretEntry(entry) {
    if (entry === undefined || entry === null) return { present: false };
    if (typeof entry === "string") {
        return { present: true, readable: true, value: entry };
    }
    if (typeof entry === "object" && typeof entry.value === "string") {
        const protection = entry.protection;
        const scheme = protection?.scheme;
        const readable =
            !protection ||
            (protection.encrypted !== true &&
                (scheme === undefined || READABLE_SECRET_SCHEMES.has(scheme)));
        return {
            present: true,
            readable,
            value: readable ? entry.value : undefined,
            scheme: scheme ?? "unknown",
        };
    }
    return { present: false }; // malformed → treat as absent
}

/**
 * SiloCore: Context and Secret Provisioner.
 * Reconstructed from .d.ts signatures.
 */
export class SiloCore {
    constructor(config = {}) {
        this.config = config;
        this.storagePath = config.storagePath || path.join(resolveSiloHome(), "identity.json");
    }

    /**
     * Ensure the storage directory exists.
     */
    _ensureStorage() {
        const dir = path.dirname(this.storagePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE });
        }
        applyMode(dir, DIRECTORY_MODE);
    }

    _readStore(failureLabel = "store") {
        if (!existsSync(this.storagePath)) return {};
        try {
            return JSON.parse(readFileSync(this.storagePath, "utf-8"));
        } catch (e) {
            console.error(`[Silo] Failed to load ${failureLabel}: ${e.message}`);
            return {};
        }
    }

    _writeStore(store) {
        this._ensureStorage();
        const nextStore = {
            schemaVersion: SILO_STORE_SCHEMA_VERSION,
            ...store,
        };
        writeFileSync(this.storagePath, JSON.stringify(nextStore, null, 2), { mode: FILE_MODE });
        applyMode(this.storagePath, FILE_MODE);
    }

    /**
     * Describe the current storage protection contract without loading identity crypto.
     */
    describeProtection() {
        return {
            schemaVersion: SILO_STORE_SCHEMA_VERSION,
            storagePath: this.storagePath,
            current: cloneProtection(),
            planned: PLANNED_SECRET_PROTECTION.map((entry) => ({ ...entry })),
            identityClosure: {
                package: "@refarm.dev/heartwood",
                requiredForStorage: false,
                loadedBy: ["bootstrapIdentity", "./key-manager"],
            },
        };
    }

    /**
     * Save tokens to persistent storage.
     */
    async saveTokens(tokens) {
        const current = this._readStore("tokens");
        
        current.tokens = { ...current.tokens, ...tokens };
        current.updatedAt = new Date().toISOString();
        
        this._writeStore(current);
        return { status: "success", path: this.storagePath };
    }

    /**
     * Load tokens from persistent storage.
     */
    async loadTokens() {
        return this._readStore("tokens").tokens || {};
    }

    /**
     * Save a secret under a namespace, separate from the flat token map.
     * @param {string} namespace
     * @param {string} id
     * @param {string} value
     */
    async saveSecret(namespace, id, value) {
        const current = this._readStore("secret");

        current.secrets = current.secrets || {};
        current.secrets[namespace] = current.secrets[namespace] || {};
        current.secrets[namespace][id] = createSecretEnvelope(value);
        current.updatedAt = new Date().toISOString();

        this._writeStore(current);
        return { status: "success", namespace, id, path: this.storagePath };
    }

    /**
     * Load a namespaced secret.
     * @param {string} namespace
     * @param {string} id
     * @returns {Promise<string|undefined>}
     */
    async loadSecret(namespace, id) {
        const data = this._readStore("secret");
        const entry = classifySecretEntry(data.secrets?.[namespace]?.[id]);
        if (!entry.present) return undefined;
        if (!entry.readable) throw new UnreadableSecretError(entry.scheme);
        return entry.value;
    }

    /**
     * List all secrets under a namespace.
     * @param {string} namespace
     * @returns {Promise<Record<string, string>>}
     */
    async listSecrets(namespace) {
        const entries = this._readStore("secrets").secrets?.[namespace] || {};
        const out = {};
        for (const [id, raw] of Object.entries(entries)) {
            const entry = classifySecretEntry(raw);
            // Unreadable entries (encrypted/unknown scheme) are omitted rather
            // than returned as raw values; use loadSecret for a precise error.
            if (entry.present && entry.readable) out[id] = entry.value;
        }
        return out;
    }

    /**
     * Remove one namespaced secret.
     * @param {string} namespace
     * @param {string} id
     */
    async removeSecret(namespace, id) {
        const current = this._readStore("secret");
        const secrets = current.secrets?.[namespace];
        const removed = Boolean(secrets && Object.hasOwn(secrets, id));

        if (!removed) {
            return { status: "success", namespace, id, removed: false, path: this.storagePath };
        }

        delete secrets[id];
        if (Object.keys(secrets).length === 0) {
            delete current.secrets[namespace];
        }
        current.updatedAt = new Date().toISOString();
        this._writeStore(current);

        return { status: "success", namespace, id, removed: true, path: this.storagePath };
    }

    /**
     * Load configuration from a remote source (Sovereign Graph).
     */
    async loadRemoteConfig(url) {
        console.log(`📡 [Silo] Fetching remote configuration from ${url}...`);
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            
            // Merge remote config into current context
            this.config = { ...this.config, ...data };
            return { status: "success", strategy: data.strategy || "ephemeral" };
        } catch (e) {
            console.error(`[Silo] Failed to fetch remote config: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }

    /**
     * Resolve all context tokens based on current config and environment.
     * In the sovereign model, this looks for GITHUB_TOKEN, CLOUDFLARE_API_TOKEN, etc.
     */
    async resolve() {
        const tokens = new Map();
        const storedTokens = await this.loadTokens();
        
        // Priority: 
        // 1. Remote Overrides (from this.config.tokens if loaded via Sovereign Graph)
        // 2. Environment Variables
        // 3. Stored Tokens
        const mapping = {
            GITHUB_TOKEN: this.config.tokens?.githubToken || process.env.GITHUB_TOKEN || storedTokens.githubToken,
            CLOUDFLARE_API_TOKEN: this.config.tokens?.cloudflareToken || process.env.CLOUDFLARE_API_TOKEN || storedTokens.cloudflareToken
        };

        for (const [key, value] of Object.entries(mapping)) {
            if (value) tokens.set(key, value);
        }

        return tokens;
    }


    /**
     * Provision the context to a specific target.
     */
    async provision(targetType = "object") {
        const tokenMap = await this.resolve();
        const tokens = Object.fromEntries(tokenMap);

        if (targetType === "github_env") {
            const content = this.toGitHubEnv(tokens);
            // If we are in a CI environment (GITHUB_ENV path exists), we would write it.
            return content;
        }

        return tokens;
    }

    /**
     * Reconstruct identity artifacts.
     */
    async bootstrapIdentity() {
        const { KeyManager } = await import("./key-manager.js");
        const km = new KeyManager(this.config);
        const masterKey = await km.generateMasterKey();
        
        await this.saveIdentityMetadata({
            masterPublicKey: masterKey.publicKey,
            bootstrappedAt: masterKey.createdAt
        });

        return { 
            status: "ready", 
            publicKey: masterKey.publicKey,
            timestamp: masterKey.createdAt 
        };
    }

    /**
     * Save non-sensitive identity metadata to the identity.json file.
     */
    async saveIdentityMetadata(metadata) {
        const current = this._readStore("identity metadata");
        
        current.identity = { ...current.identity, ...metadata };
        current.updatedAt = new Date().toISOString();
        
        this._writeStore(current);
    }


    /**
     * Format tokens for GitHub Actions environment file.
     */
    toGitHubEnv(tokens) {
        return Object.entries(tokens)
            .map(([key, val]) => `${key}=${val}`)
            .join("\n");
    }
}

export function resolveSiloHome(env = process.env) {
    const configured = typeof env.SILO_HOME === "string" ? env.SILO_HOME.trim() : "";
    const refarmHome = typeof env.REFARM_HOME === "string" ? env.REFARM_HOME.trim() : "";
    return configured || refarmHome || path.join(os.homedir(), ".silo");
}

export default SiloCore;
