import { GitHubProvider } from "./providers/github.js";
import { CloudflareProvider } from "./providers/cloudflare.js";
import path from "node:path";

/**
 * Windmill: Infrastructure Provider Bridges.
 * Handles reconciliation of DNS and Repository state.
 */
export class WindmillEngine {
    constructor(config, options = {}) {
        this.config = config;
        this.options = options;
        this.github = new GitHubProvider(config);
        this.cloudflare = new CloudflareProvider(config);
    }

    /**
     * Pull current infrastructure state from providers.
     */
    async pull() {
        console.log("📥 [Windmill] Pulling infrastructure state...");
        const state = {
            github: { exists: false, visibility: "unknown" },
            cloudflare: { records: [] }
        };

        // GitHub Pull
        if (this.config.infrastructure?.gitHost === "github") {
            const repoName = this.config.brand?.slug || "refarm-project";
            const repos = await this.github.listRepos();
            if (repos.includes(repoName)) {
                state.github.exists = true;
                // Add more metadata if needed
            }
        }

        // Cloudflare Pull
        if (this.config.infrastructure?.cloudflare) {
            state.cloudflare.records = await this.cloudflare.listRecords();
        }

        return state;
    }

    /**
     * Reconcile infrastructure state with the configuration.
     */
    async sync() {
        const results = {
            github: null,
            cloudflare: null,
            status: "pending"
        };

        console.log("🚀 [Windmill] Starting infrastructure synchronization...");
        
        // 0. Pull current state for context
        const currentState = await this.pull();

        // 1. GitHub Reconciliation (Mirroring/Audit)
        if (this.config.infrastructure?.gitHost === "github") {
            const repoName = this.config.brand?.slug || "refarm-project";
            const backupUrl = this.config.infrastructure?.backup?.repository;
            
            if (backupUrl) {
                results.github = await this.github.mirrorRepo(repoName, backupUrl, {
                    dryRun: this.options.dryRun
                });
            } else {
                console.warn("⚠️ [Windmill] No backup repository configured, skipping mirror.");
                results.github = { status: "skipped", message: "No backup URL" };
            }
        }

        // 2. Cloudflare DNS Reconciliation
        const dnsRecords = this.config.infrastructure?.cloudflare?.dns || [];
        if (dnsRecords.length > 0) {
            results.cloudflare = await this.cloudflare.syncRecords(dnsRecords, {
                dryRun: this.options.dryRun
            });
        } else {
            console.log("ℹ️ [Windmill] No DNS records defined in configuration.");
            results.cloudflare = { status: "skipped", message: "No records defined" };
        }

        results.status = "completed";
        return results;
    }

    /**
     * Deploy artifacts to sovereign targets.
     * Orchestrates multiple targets if defined in config.
     * @param {"cloudflare" | "github" | "all"} [target] - The target platform.
     * @returns {Promise<{status: string, results?: any[], message?: string}>}
     */
    async deploy(target = "all") {
        console.log(`🚀 [Windmill] Deploying to ${target}...`);
        
        const distribution = this.config.distribution?.targets || [];
        const results = [];

        if (target === "all") {
            if (distribution.length === 0) {
                return { status: "error", message: "No distribution targets defined in refarm.config.json" };
            }

            for (const t of distribution) {
                const result = await this._deployToTarget(t);
                results.push({ target: t.type, ...result });
            }

            const failed = results.filter(r => r.status === "error");
            return { 
                status: failed.length > 0 ? "partial_failure" : "success", 
                results 
            };
        } else {
            // Single target deployment
            const targetConfig = distribution.find(t => t.type === target) || { type: target };
            const result = await this._deployToTarget(targetConfig);
            return { status: result.status, ...result };
        }
    }

    /**
     * Internal helper to route deployment to specific provider.
     */
    async _deployToTarget(targetConfig) {
        const { type, site, repo, dist } = targetConfig;
        const projectDir = path.resolve(process.cwd(), dist || "dist");
        
        if (type === "cloudflare") {
            const siteName = site || this.config.brand?.slug || "refarm-site";
            return await this.cloudflare.deployPages(siteName, projectDir, {
                dryRun: this.options.dryRun
            });
        }

        if (type === "github") {
            const repoName = repo || this.config.brand?.slug || "refarm-repo";
            return await this.github.deployPages(repoName, projectDir, {
                dryRun: this.options.dryRun
            });
        }

        return { status: "error", message: `Unsupported deployment target: ${type}` };
    }
}

export { WindmillEngine as Windmill };
