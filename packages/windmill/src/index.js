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
     * Reconcile infrastructure state with the configuration.
     */
    async sync() {
        const results = {
            github: null,
            cloudflare: null
        };

        console.log("🚀 [Windmill] Starting infrastructure synchronization...");

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
        }

        return results;
    }
}

export { WindmillEngine as Windmill };
