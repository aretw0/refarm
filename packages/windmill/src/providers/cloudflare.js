/**
 * Cloudflare Infrastructure Provider Bridge
 * Stateless and runtime-neutral provider for DNS management.
 */
export class CloudflareProvider {
    constructor(config) {
        this.config = config;
        this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
        this.zoneId = config.infrastructure?.cloudflare?.zoneId || process.env.CLOUDFLARE_ZONE_ID;
        this.baseUrl = "https://api.cloudflare.com/client/v4";
    }

    /**
     * Reconcile DNS records with the provider
     */
    async syncRecords(desiredRecords, options = {}) {
        if (!this.apiToken || !this.zoneId) {
            console.warn("[Cloudflare] Missing API Token or Zone ID, skipping DNS sync.");
            return { status: "error", message: "Missing credentials" };
        }

        const actualRecords = await this.listRecords();
        const changes = [];

        for (const desired of desiredRecords) {
            const existing = actualRecords.find(r => r.name === desired.name && r.type === desired.type);
            
            if (!existing) {
                changes.push({ action: "create", record: desired });
            } else if (existing.content !== desired.content || existing.proxied !== desired.proxied) {
                changes.push({ action: "update", id: existing.id, record: desired });
            }
        }

        if (options.dryRun) {
            console.log(`[Cloudflare] [DRY RUN] Would apply ${changes.length} changes.`);
            for (const change of changes) {
                console.log(`  - ${change.action.toUpperCase()}: ${change.record.name} (${change.record.type}) -> ${change.record.content}`);
            }
            return { status: "dry-run", changes };
        }

        // Real API implementation
        for (const change of changes) {
            if (change.action === "create") {
                await this.apiCall("POST", `/zones/${this.zoneId}/dns_records`, change.record);
            } else {
                await this.apiCall("PUT", `/zones/${this.zoneId}/dns_records/${change.id}`, change.record);
            }
        }

        return { status: "success", changesApplied: changes.length };
    }

    async listRecords() {
        const response = await this.apiCall("GET", `/zones/${this.zoneId}/dns_records`);
        return response.result || [];
    }

    async apiCall(method, path, body = null) {
        const url = `${this.baseUrl}${path}`;
        const options = {
            method,
            headers: {
                "Authorization": `Bearer ${this.apiToken}`,
                "Content-Type": "application/json"
            }
        };

        if (body) options.body = JSON.stringify(body);

        try {
            const res = await fetch(url, options);
            const data = await res.json();
            if (!res.ok) throw new Error(data.errors?.[0]?.message || "API Error");
            return data;
        } catch (e) {
            console.error(`[Cloudflare] API Error: ${e.message}`);
            throw e;
        }
    }
}
