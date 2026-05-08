import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { turboCacheManifest } from "@refarm.dev/infra-turbo-cache";
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
	dryRun?: boolean;
}

export interface CloudflareTurboCacheProvisionOutput {
	workerUrl: string;
	authToken: string;
	bucketName: string;
	plan: CloudflareProvisionPlan;
}

export function createCloudflareTurboCacheProvisionPlan(
	input: CloudflareTurboCacheProvisionInput = {},
): CloudflareProvisionPlan {
	const bucketName = input.bucketName ?? DEFAULT_BUCKET_NAME;
	const workerName = input.workerName ?? DEFAULT_WORKER_NAME;
	const team = input.team ?? DEFAULT_TEAM;

	return {
		provider: "cloudflare",
		serviceId: turboCacheManifest.id,
		displayName: turboCacheManifest.displayName,
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

		await this.ensureBucket(bucketName);
		await this.setSecret("AUTH_TOKEN", authToken);
		const workerUrl = await this.deploy();

		return { workerUrl, authToken, bucketName, plan };
	}

	private async ensureBucket(name: string): Promise<void> {
		try {
			await this.provider.exec(["r2", "bucket", "create", name], WORKER_DIR);
		} catch (err) {
			if (!isAlreadyExists(err)) throw err;
		}
	}

	private async setSecret(key: string, value: string): Promise<void> {
		await this.provider.execWithStdin(
			["secret", "put", key],
			value,
			WORKER_DIR,
		);
	}

	private async deploy(): Promise<string> {
		const { stdout } = await this.provider.exec(["deploy"], WORKER_DIR);
		const match = stdout.match(/https:\/\/[^\s]+\.workers\.dev/);
		return match?.[0] ?? "<url-not-found>";
	}
}

function isAlreadyExists(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes("already exists");
}
