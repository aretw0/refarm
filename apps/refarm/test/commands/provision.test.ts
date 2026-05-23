import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCreateCloudflareProvider,
	mockCreateCloudflareTurboCacheProvisionPlan,
	mockLoadTokens,
	mockProvision,
	mockSpawnSync,
	mockSiloCore,
	mockTurboCacheProvisioner,
} = vi.hoisted(() => {
	const mockLoadTokens = vi.fn();
	const mockProvision = vi.fn();
	const mockSpawnSync = vi.fn();
	return {
		mockCreateCloudflareProvider: vi.fn(),
		mockCreateCloudflareTurboCacheProvisionPlan: vi.fn((input) => ({
			provider: "cloudflare",
			serviceId: "turbo-cache",
			displayName: "Turborepo Remote Cache",
			resources: [
				{
					kind: "r2-bucket",
					action: "ensure",
					name: input.bucketName,
					description: `Store Turborepo artifacts for team "${input.team}"`,
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
					name: "refarm-turbo-cache",
					description:
						"Cloudflare Worker implementing Turborepo Remote Cache API v8",
				},
			],
			ciSecrets: ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"],
		})),
		mockLoadTokens,
		mockProvision,
		mockSpawnSync,
		mockSiloCore: vi.fn().mockImplementation(function () {
			return { loadTokens: mockLoadTokens };
		}),
		mockTurboCacheProvisioner: vi.fn().mockImplementation(function () {
			return { provision: mockProvision };
		}),
	};
});

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

vi.mock("@refarm.dev/silo", () => ({
	SiloCore: mockSiloCore,
}));

vi.mock("@refarm.dev/infra-cloudflare", () => ({
	CloudflareProvider: {
		create: mockCreateCloudflareProvider,
	},
	CloudflareTurboCacheProvisioner: mockTurboCacheProvisioner,
	createCloudflareTurboCacheProvisionPlan:
		mockCreateCloudflareTurboCacheProvisionPlan,
	// Pass-through: tests assert on the original error message, enrichment is unit-tested separately.
	enrichCloudflareError: (err: unknown) => err instanceof Error ? err : new Error(String(err)),
}));

import { provisionCommand } from "../../src/commands/provision.js";

describe("provision command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "" });
		provisionCommand.commands
			.find((command) => command.name() === "cloudflare")
			?.setOptionValue("dryRun", undefined);
		process.exitCode = undefined;
	});

	it("renders a Cloudflare turbo-cache dry-run plan without loading tokens", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(
			[
				"cloudflare",
				"turbo-cache",
				"--dry-run",
				"--bucket",
				"refarm-cache-test",
				"--team",
				"garden",
			],
			{ from: "user" },
		);

		expect(mockCreateCloudflareTurboCacheProvisionPlan).toHaveBeenCalledWith({
			bucketName: "refarm-cache-test",
			team: "garden",
		});
		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("dry-run — no resources will be created"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("r2-bucket:refarm-cache-test"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("TURBO_CACHE_API_URL"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("lists provisionable providers and services without loading tokens", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(["list"], { from: "user" });

		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Provisionable services"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("cloudflare turbo-cache"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints provision catalog as JSON without loading tokens", async () => {
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(["list", "--json"], { from: "user" });

		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			command: string;
			operation: string;
			providers: Array<{ id: string; services: Array<{ id: string }> }>;
			nextActions: string[];
		};
		expect(payload).toMatchObject({
			command: "provision",
			operation: "catalog",
		});
		expect(payload.providers[0]).toMatchObject({
			id: "cloudflare",
			services: [expect.objectContaining({ id: "turbo-cache" })],
		});
		expect(payload.nextActions).toContain(
			"refarm provision cloudflare turbo-cache --dry-run",
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints provision guidance when no subcommand is selected", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync([], { from: "user" });

		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Provisionable services"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm provision cloudflare turbo-cache --dry-run"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("renders a provider-level Cloudflare dry-run without loading tokens", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(["cloudflare", "--dry-run"], {
			from: "user",
		});

		expect(mockCreateCloudflareTurboCacheProvisionPlan).toHaveBeenCalledWith({
			bucketName: "refarm-turbo-cache",
			team: "refarm",
		});
		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Cloudflare services"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Provider-only mode does not create resources"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("dry-run — no resources will be created"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("renders a provider-level Cloudflare dry-run as JSON", async () => {
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(["cloudflare", "--dry-run", "--json"], {
			from: "user",
		});

		expect(mockCreateCloudflareTurboCacheProvisionPlan).toHaveBeenCalledWith({
			bucketName: "refarm-turbo-cache",
			team: "refarm",
		});
		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			provider: string;
			operation: string;
			plan: { serviceId: string };
		};
		expect(payload).toMatchObject({
			provider: "cloudflare",
			operation: "dry-run",
			plan: { serviceId: "turbo-cache" },
		});

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("shows executable Cloudflare next steps when no service is selected", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(["cloudflare"], {
			from: "user",
		});

		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Next steps"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm provision cloudflare turbo-cache --dry-run"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm provision cloudflare turbo-cache --github-secrets"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("documents service subcommands in provision help", () => {
		let help = "";
		provisionCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		provisionCommand.outputHelp();

		expect(help).toContain("refarm provision cloudflare turbo-cache --dry-run");
		expect(help).toContain("Running a provider without a service prints guidance only; it does not create resources");
		expect(help).toContain("Rebuilding the devcontainer does not clear saved ~/.refarm credentials by default");
	});

	it("documents credentials and GitHub secret requirements in turbo-cache help", () => {
		const cloudflare = provisionCommand.commands.find(
			(command) => command.name() === "cloudflare",
		);
		const turboCache = cloudflare?.commands.find(
			(command) => command.name() === "turbo-cache",
		);
		let help = "";
		turboCache?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		turboCache?.outputHelp();

		expect(help).toContain("Requires a Cloudflare token saved by refarm sow --cloudflare");
		expect(help).toContain("--dry-run does not require credentials");
		expect(help).toContain("--github-secrets writes TURBO_CACHE_* via gh");
		expect(help).toContain("Rebuilding the devcontainer does not clear saved ~/.refarm credentials by default");
	});

	it("renders a Cloudflare turbo-cache dry-run as JSON without loading tokens", async () => {
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(
			[
				"cloudflare",
				"turbo-cache",
				"--dry-run",
				"--json",
				"--bucket",
				"refarm-cache-test",
				"--team",
				"garden",
			],
			{ from: "user" },
		);

		expect(mockSiloCore).not.toHaveBeenCalled();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			provider: string;
			service: string;
			operation: string;
			input: { bucket: string; team: string };
			plan: { resources: Array<{ name: string }> };
		};
		expect(payload).toMatchObject({
			provider: "cloudflare",
			service: "turbo-cache",
			operation: "dry-run",
			input: { bucket: "refarm-cache-test", team: "garden" },
		});
		expect(payload.plan.resources[0]).toMatchObject({
			name: "refarm-cache-test",
		});

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("provisions Cloudflare turbo-cache with stored Cloudflare token", async () => {
		const provider = { accountId: "account-1" };
		mockLoadTokens.mockResolvedValue({ cloudflareToken: "cf-token" });
		mockCreateCloudflareProvider.mockResolvedValue(provider);
		mockProvision.mockResolvedValue({
			workerUrl: "https://refarm-cache.example.workers.dev",
			authToken: "generated-token",
			bucketName: "refarm-cache-test",
			plan: { provider: "cloudflare", serviceId: "turbo-cache" },
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(
			[
				"cloudflare",
				"turbo-cache",
				"--bucket",
				"refarm-cache-test",
				"--team",
				"garden",
			],
			{ from: "user" },
		);

		expect(mockSiloCore).toHaveBeenCalledOnce();
		expect(mockCreateCloudflareProvider).toHaveBeenCalledWith({
			apiToken: "cf-token",
		});
		expect(mockTurboCacheProvisioner).toHaveBeenCalledWith(provider);
		expect(mockProvision).toHaveBeenCalledWith({
			bucketName: "refarm-cache-test",
			team: "garden",
		});
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Worker deployed → https://refarm-cache.example.workers.dev",
			),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("TURBO_CACHE_TOKEN"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("<redacted>"),
		);
		expect(logSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("generated-token"),
		);
		expect(mockSpawnSync).not.toHaveBeenCalled();

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("writes produced Cloudflare turbo-cache secrets to GitHub without printing the token", async () => {
		const provider = { accountId: "account-1" };
		mockLoadTokens.mockResolvedValue({ cloudflareToken: "cf-token" });
		mockCreateCloudflareProvider.mockResolvedValue(provider);
		mockProvision.mockResolvedValue({
			workerUrl: "https://refarm-cache.example.workers.dev",
			authToken: "generated-token",
			bucketName: "refarm-cache-test",
			plan: { provider: "cloudflare", serviceId: "turbo-cache" },
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(
			[
				"cloudflare",
				"turbo-cache",
				"--bucket",
				"refarm-cache-test",
				"--team",
				"garden",
				"--github-secrets",
			],
			{ from: "user" },
		);

		expect(mockProvision).toHaveBeenCalledWith({
			bucketName: "refarm-cache-test",
			team: "garden",
		});
		expect(mockSpawnSync).toHaveBeenCalledWith(
			"gh",
			["secret", "set", "TURBO_CACHE_API_URL"],
			expect.objectContaining({
				input: "https://refarm-cache.example.workers.dev",
				stdio: ["pipe", "pipe", "pipe"],
			}),
		);
		expect(mockSpawnSync).toHaveBeenCalledWith(
			"gh",
			["secret", "set", "TURBO_CACHE_TOKEN"],
			expect.objectContaining({
				input: "generated-token",
				stdio: ["pipe", "pipe", "pipe"],
			}),
		);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("GitHub secret TURBO_CACHE_TOKEN set"),
		);
		expect(logSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("generated-token"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("fails offline when no stored Cloudflare token exists", async () => {
		mockLoadTokens.mockResolvedValue(null);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(["cloudflare", "turbo-cache"], {
			from: "user",
		});

		expect(mockSiloCore).toHaveBeenCalledOnce();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("No Cloudflare token found"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm provision cloudflare turbo-cache --github-secrets"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("--dry-run only to inspect the plan"),
		);
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports missing Cloudflare token as JSON without human stderr", async () => {
		mockLoadTokens.mockResolvedValue(null);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(
			["cloudflare", "turbo-cache", "--json"],
			{ from: "user" },
		);

		expect(mockSiloCore).toHaveBeenCalledOnce();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			ok: boolean;
			error: string;
			nextAction: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "missing-cloudflare-token",
			nextAction: "refarm sow --cloudflare",
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("fails offline when Cloudflare provider creation fails", async () => {
		mockLoadTokens.mockResolvedValue({ cloudflareToken: "cf-token" });
		mockCreateCloudflareProvider.mockRejectedValue(
			new Error("bad credentials"),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(["cloudflare", "turbo-cache"], {
			from: "user",
		});

		expect(mockCreateCloudflareProvider).toHaveBeenCalledWith({
			apiToken: "cf-token",
		});
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Failed to connect to Cloudflare"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("bad credentials"),
		);
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("fails offline when Cloudflare turbo-cache provisioning fails", async () => {
		const provider = { accountId: "account-1" };
		mockLoadTokens.mockResolvedValue({ cloudflareToken: "cf-token" });
		mockCreateCloudflareProvider.mockResolvedValue(provider);
		mockProvision.mockRejectedValue(new Error("wrangler failed"));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await provisionCommand.parseAsync(
			[
				"cloudflare",
				"turbo-cache",
				"--bucket",
				"refarm-cache-test",
				"--team",
				"garden",
			],
			{ from: "user" },
		);

		expect(mockTurboCacheProvisioner).toHaveBeenCalledWith(provider);
		expect(mockProvision).toHaveBeenCalledWith({
			bucketName: "refarm-cache-test",
			team: "garden",
		});
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Provisioning failed"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("wrangler failed"),
		);
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
