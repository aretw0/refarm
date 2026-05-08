import { describe, expect, it } from "vitest";
import type { CloudflareProvider, ExecResult } from "../../provider.js";
import {
	CloudflareTurboCacheProvisioner,
	createCloudflareTurboCacheProvisionPlan,
} from "./provision.js";

interface ProviderCall {
	kind: "exec" | "stdin";
	args: string[];
	input?: string;
	cwd: string;
}

function createProvider(
	options: {
		execResults?: ExecResult[];
		execErrors?: Record<string, Error>;
	} = {},
) {
	const calls: ProviderCall[] = [];
	const execResults = [...(options.execResults ?? [])];
	const execErrors = options.execErrors ?? {};

	const provider: CloudflareProvider = {
		apiToken: "test-token",
		accountId: "test-account",
		wranglerBin: "wrangler",
		env: () => ({ CLOUDFLARE_API_TOKEN: "test-token" }),
		exec: async (args: string[], cwd: string) => {
			calls.push({ kind: "exec", args, cwd });
			const key = args.join(" ");
			const error = execErrors[key];
			if (error) throw error;
			return execResults.shift() ?? { stdout: "", stderr: "" };
		},
		execWithStdin: async (args: string[], input: string, cwd: string) => {
			calls.push({ kind: "stdin", args, input, cwd });
			return { stdout: "", stderr: "" };
		},
	};

	return { provider, calls };
}

describe("createCloudflareTurboCacheProvisionPlan", () => {
	it("describes Cloudflare resources without executing Cloudflare calls", () => {
		expect(
			createCloudflareTurboCacheProvisionPlan({
				bucketName: "refarm-cache-test",
				workerName: "refarm-worker-test",
				team: "garden",
			}),
		).toEqual({
			provider: "cloudflare",
			serviceId: "turbo-cache",
			displayName: "Turborepo Remote Cache",
			servicePlan: {
				serviceId: "turbo-cache",
				displayName: "Turborepo Remote Cache",
				team: "garden",
				requirements: [
					{
						kind: "artifact-storage",
						name: "artifact-store",
						description: 'Durable artifact storage scoped for team "garden"',
					},
					{
						kind: "http-endpoint",
						name: "cache-api",
						description:
							"HTTP endpoint implementing Turborepo Remote Cache API v8",
					},
					{
						kind: "bearer-auth",
						name: "cache-auth-token",
						description:
							"Bearer token required by CI clients that read/write cache artifacts",
						secret: true,
					},
				],
				ciSecrets: ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"],
			},
			resources: [
				{
					kind: "r2-bucket",
					action: "ensure",
					name: "refarm-cache-test",
					description: 'Store Turborepo artifacts for team "garden"',
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
					name: "refarm-worker-test",
					description:
						"Cloudflare Worker implementing Turborepo Remote Cache API v8",
				},
			],
			ciSecrets: ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"],
		});
	});
});

describe("CloudflareTurboCacheProvisioner", () => {
	it("returns a dry-run envelope without calling Cloudflare", async () => {
		const { provider, calls } = createProvider();
		const provisioner = new CloudflareTurboCacheProvisioner(provider);

		await expect(
			provisioner.provision({
				dryRun: true,
				bucketName: "refarm-cache-test",
				authToken: "provided-token",
			}),
		).resolves.toMatchObject({
			workerUrl: "<dry-run>",
			authToken: "provided-token",
			bucketName: "refarm-cache-test",
			plan: {
				provider: "cloudflare",
				serviceId: "turbo-cache",
			},
		});

		expect(calls).toEqual([]);
	});

	it("creates the bucket, stores the secret, and deploys the worker", async () => {
		const { provider, calls } = createProvider({
			execResults: [
				{ stdout: "bucket created", stderr: "" },
				{
					stdout: "Uploaded https://refarm-cache.example.workers.dev",
					stderr: "",
				},
			],
		});
		const provisioner = new CloudflareTurboCacheProvisioner(provider);

		const result = await provisioner.provision({
			bucketName: "refarm-cache-test",
			authToken: "provided-token",
		});

		expect(result).toMatchObject({
			workerUrl: "https://refarm-cache.example.workers.dev",
			authToken: "provided-token",
			bucketName: "refarm-cache-test",
			plan: {
				provider: "cloudflare",
				serviceId: "turbo-cache",
			},
		});
		expect(
			calls.map((call) => ({
				kind: call.kind,
				args: call.args,
				input: call.input,
			})),
		).toEqual([
			{
				kind: "exec",
				args: ["r2", "bucket", "create", "refarm-cache-test"],
				input: undefined,
			},
			{
				kind: "stdin",
				args: ["secret", "put", "AUTH_TOKEN"],
				input: "provided-token",
			},
			{ kind: "exec", args: ["deploy"], input: undefined },
		]);
	});

	it("continues when the R2 bucket already exists", async () => {
		const { provider, calls } = createProvider({
			execErrors: {
				"r2 bucket create refarm-cache-test": new Error(
					"bucket already exists",
				),
			},
			execResults: [
				{ stdout: "https://refarm-cache.example.workers.dev", stderr: "" },
			],
		});
		const provisioner = new CloudflareTurboCacheProvisioner(provider);

		await expect(
			provisioner.provision({
				bucketName: "refarm-cache-test",
				authToken: "provided-token",
			}),
		).resolves.toMatchObject({
			workerUrl: "https://refarm-cache.example.workers.dev",
		});
		expect(calls).toHaveLength(3);
	});

	it("surfaces unexpected bucket creation errors", async () => {
		const { provider } = createProvider({
			execErrors: {
				"r2 bucket create refarm-cache-test": new Error("permission denied"),
			},
		});
		const provisioner = new CloudflareTurboCacheProvisioner(provider);

		await expect(
			provisioner.provision({
				bucketName: "refarm-cache-test",
				authToken: "provided-token",
			}),
		).rejects.toThrow("permission denied");
	});
});
