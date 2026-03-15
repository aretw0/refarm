import { GitHubProvider } from "./providers/github.js";
import { CloudflareProvider } from "./providers/cloudflare.js";

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
}

export { WindmillEngine as Windmill };
