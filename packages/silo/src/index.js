import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { KeyManager } from "./key-manager.js";


/**
 * SiloCore: Context and Secret Provisioner.
 * Reconstructed from .d.ts signatures.
 */
export class SiloCore {
    constructor(config = {}) {
        this.config = config;
        this.storagePath = path.join(os.homedir(), ".refarm", "identity.json");
    }

    /**
     * Ensure the storage directory exists.
     */
    _ensureStorage() {
        const dir = path.dirname(this.storagePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Save tokens to persistent storage.
     */
    async saveTokens(tokens) {
        this._ensureStorage();
        let current = {};
        if (existsSync(this.storagePath)) {
            current = JSON.parse(readFileSync(this.storagePath, "utf-8"));
        }
        
        current.tokens = { ...current.tokens, ...tokens };
        current.updatedAt = new Date().toISOString();
        
        writeFileSync(this.storagePath, JSON.stringify(current, null, 2));
        return { status: "success", path: this.storagePath };
    }

    /**
     * Load tokens from persistent storage.
     */
    async loadTokens() {
        if (!existsSync(this.storagePath)) return {};
        try {
            const data = JSON.parse(readFileSync(this.storagePath, "utf-8"));
            return data.tokens || {};
        } catch (e) {
            console.error(`[Silo] Failed to load tokens: ${e.message}`);
            return {};
        }
    }


    /**
     * Load configuration from a remote source (Sovereign Graph).
     */
    async loadRemoteConfig(url) {
        console.log(`📡 [Silo] Fetching remote configuration from ${url}...`);
        try {
            const res = await fetch(url);
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
            'REFARM_GITHUB_TOKEN': this.config.tokens?.githubToken || process.env.GITHUB_TOKEN || process.env.REFARM_GITHUB_TOKEN || storedTokens.githubToken,
            'REFARM_CLOUDFLARE_API_TOKEN': this.config.tokens?.cloudflareToken || process.env.CLOUDFLARE_API_TOKEN || process.env.REFARM_CLOUDFLARE_API_TOKEN || storedTokens.cloudflareToken
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
        this._ensureStorage();
        let current = {};
        if (existsSync(this.storagePath)) {
            current = JSON.parse(readFileSync(this.storagePath, "utf-8"));
        }
        
        current.identity = { ...current.identity, ...metadata };
        current.updatedAt = new Date().toISOString();
        
        writeFileSync(this.storagePath, JSON.stringify(current, null, 2));
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

export default SiloCore;
