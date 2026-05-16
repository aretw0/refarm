import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createTurboCacheServicePlan,
	turboCacheManifest,
} from "@refarm.dev/infra-turbo-cache";
import type { TurboCacheServicePlan } from "@refarm.dev/infra-turbo-cache";
import {
	DEFAULT_RETENTION_POLICY,
	type RetentionPolicy,
} from "@refarm.dev/policy-contract-v1";
import type { CloudflareProvider } from "../../provider.js";
import type { CloudflareProvisionPlan } from "../../types.js";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "worker");
const DEFAULT_BUCKET_NAME = "refarm-turbo-cache";
const DEFAULT_WORKER_NAME = "refarm-turbo-cache";
const DEFAULT_TEAM = "refarm";

export interface CloudflareTurboCacheProvisionInput {
	bucketName?: string;
	workerName?: string;
	team?: string;
	authToken?: string;
	/** Retention policy — overrides the defaults baked into wrangler.toml.
	 *  Propagated as Worker vars so the policy is live without redeploying. */
	retention?: RetentionPolicy;
	dryRun?: boolean;
}

export interface CloudflareTurboCacheProvisionPlan
	extends CloudflareProvisionPlan<TurboCacheServicePlan> {}

export interface CloudflareTurboCacheProvisionOutput {
	workerUrl: string;
	authToken: string;
	bucketName: string;
	plan: CloudflareTurboCacheProvisionPlan;
}

export function createCloudflareTurboCacheProvisionPlan(
	input: CloudflareTurboCacheProvisionInput = {},
): CloudflareTurboCacheProvisionPlan {
	const bucketName = input.bucketName ?? DEFAULT_BUCKET_NAME;
	const workerName = input.workerName ?? DEFAULT_WORKER_NAME;
	const team = input.team ?? DEFAULT_TEAM;

	return {
		provider: "cloudflare",
		serviceId: turboCacheManifest.id,
		displayName: turboCacheManifest.displayName,
		servicePlan: createTurboCacheServicePlan({ team }),
		resources: [
			{
				kind: "r2-bucket",
				action: "ensure",
				name: bucketName,
				description: `Store Turborepo artifacts for team "${team}"`,
			},
			{
				kind: "secret",
				action: "set",
				name: "AUTH_TOKEN",
				description: "Bearer token accepted by the remote cache Worker",
				secret: true,
			},
			{
				kind: "worker",
				action: "deploy",
				name: workerName,
				description:
					"Cloudflare Worker implementing Turborepo Remote Cache API v8",
			},
		],
		ciSecrets: turboCacheManifest.ciSecrets,
	};
}

export class CloudflareTurboCacheProvisioner {
	constructor(private readonly provider: CloudflareProvider) {}

	async provision(
		input: CloudflareTurboCacheProvisionInput = {},
	): Promise<CloudflareTurboCacheProvisionOutput> {
		const bucketName = input.bucketName ?? DEFAULT_BUCKET_NAME;
		const authToken = input.authToken ?? randomBytes(32).toString("hex");
		const plan = createCloudflareTurboCacheProvisionPlan(input);

		if (input.dryRun) {
			return { workerUrl: "<dry-run>", authToken, bucketName, plan };
		}

		const retention = { ...DEFAULT_RETENTION_POLICY, ...input.retention };

		await this.ensureBucket(bucketName);
		await this.setSecret("AUTH_TOKEN", authToken);
		const workerUrl = await this.deploy(retention);

		return { workerUrl, authToken, bucketName, plan };
	}

	private async ensureBucket(name: string): Promise<void> {
		try {
			await this.provider.exec(["r2", "bucket", "create", name], WORKER_DIR);
		} catch (err) {
			if (!isAlreadyExists(err)) throw enrichCloudflareError(err);
		}
	}

	private async setSecret(key: string, value: string): Promise<void> {
		await this.provider.execWithStdin(
			["secret", "put", key],
			value,
			WORKER_DIR,
		);
	}

	private async ensureWorkersSubdomain(): Promise<void> {
		const existing = await this.provider.getWorkersSubdomain();
		if (existing) return;

		// Derive a candidate from the account ID — always unique since the account
		// ID itself is unique. Cloudflare accepts alphanumeric + hyphens, max 63 chars.
		const candidate = `cf-${this.provider.accountId.slice(0, 20)}`;
		try {
			await this.provider.registerWorkersSubdomain(candidate);
		} catch (err) {
			// Name conflict (already taken globally) — ask the operator to pick one.
			const url = `https://dash.cloudflare.com/${this.provider.accountId}/workers-and-pages`;
			throw new Error(
				`Could not auto-register a workers.dev subdomain (name conflict).\n` +
				`Choose a subdomain at: ${url}`,
			);
		}
	}

	private async deploy(retention: RetentionPolicy): Promise<string> {
		await this.ensureWorkersSubdomain();
		// Push retention policy as Worker vars so they take effect immediately
		// without editing wrangler.toml. The wrangler.toml defaults act as fallback.
		const vars = [
			`ARTIFACT_TTL_SECONDS:${retention.ttlSeconds}`,
			`MAX_ARTIFACT_BYTES:${retention.maxAssetBytes}`,
			`CLEANUP_DRY_RUN:${retention.dryRun}`,
		];
		const varArgs = vars.flatMap((v) => ["--var", v]);
		const { stdout } = await this.provider.exec(["deploy", ...varArgs], WORKER_DIR);
		const match = stdout.match(/https:\/\/[^\s]+\.workers\.dev/);
		return match?.[0] ?? "<url-not-found>";
	}
}

function isAlreadyExists(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes("already exists");
}

// Known Cloudflare API error codes with actionable guidance.
const KNOWN_CF_CODES: Record<number, { summary: string; url: string }> = {
	// R2 not enabled on the account.
	10042: {
		summary: "R2 is not enabled on this Cloudflare account.",
		url: "https://dash.cloudflare.com/?to=/:account/r2/overview",
	},
};

// Text patterns for errors that do not carry a numeric code.
// Each entry: [substring to match, summary, URL extractor].
// URL extractor receives the full error message so it can surface
// account-specific URLs that wrangler already embeds in its output.
type PatternEntry = {
	pattern: string;
	summary: string;
	extractUrl: (msg: string) => string;
};

const KNOWN_CF_PATTERNS: PatternEntry[] = [
	{
		pattern: "workers.dev subdomain",
		summary: "A workers.dev subdomain must be registered before deploying a Worker.",
		// Extract the account ID from wrangler's embedded URL, then build the correct
		// Workers & Pages URL (wrangler's /workers/onboarding path returns 404).
		extractUrl: (msg) => {
			const accountId = msg.match(/dash\.cloudflare\.com\/([a-f0-9]{32})/)?.[1];
			return accountId
				? `https://dash.cloudflare.com/${accountId}/workers-and-pages`
				: "https://dash.cloudflare.com/?to=/:account/workers-and-pages";
		},
	},
];

export function enrichCloudflareError(err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);

	// Try numeric code first.
	const codeMatch = msg.match(/\[code:\s*(\d+)\]/);
	if (codeMatch) {
		const known = KNOWN_CF_CODES[Number(codeMatch[1])];
		if (known) {
			const enriched = new Error(`${known.summary}\n  → ${known.url}`);
			enriched.cause = err;
			return enriched;
		}
	}

	// Try text patterns.
	for (const entry of KNOWN_CF_PATTERNS) {
		if (msg.includes(entry.pattern)) {
			const url = entry.extractUrl(msg);
			const enriched = new Error(`${entry.summary}\n  → ${url}`);
			enriched.cause = err;
			return enriched;
		}
	}

	return err instanceof Error ? err : new Error(msg);
}
