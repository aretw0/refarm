import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCreateCloudflareProvider,
	mockCreateCloudflareTurboCacheProvisionPlan,
	mockLoadTokens,
	mockProvision,
	mockSiloCore,
	mockTurboCacheProvisioner,
} = vi.hoisted(() => {
	const mockLoadTokens = vi.fn();
	const mockProvision = vi.fn();
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
		mockSiloCore: vi.fn().mockImplementation(function () {
			return { loadTokens: mockLoadTokens };
		}),
		mockTurboCacheProvisioner: vi.fn().mockImplementation(function () {
			return { provision: mockProvision };
		}),
	};
});

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
		provisionCommand.commands
			.find((command) => command.name() === "cloudflare")
			?.setOptionValue("dryRun", undefined);
		process.exitCode = undefined;
	});

	function mockProcessExit() {
		return vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${String(code)}`);
		});
	}

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
			expect.stringContaining("dry-run — no resources will be created"),
		);

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

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("fails offline when no stored Cloudflare token exists", async () => {
		mockLoadTokens.mockResolvedValue(null);
		const exitSpy = mockProcessExit();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			provisionCommand.parseAsync(["cloudflare", "turbo-cache"], {
				from: "user",
			}),
		).rejects.toThrow("process.exit:1");

		expect(mockSiloCore).toHaveBeenCalledOnce();
		expect(mockCreateCloudflareProvider).not.toHaveBeenCalled();
		expect(mockTurboCacheProvisioner).not.toHaveBeenCalled();
		expect(mockProvision).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("No Cloudflare token found"),
		);

		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("fails offline when Cloudflare provider creation fails", async () => {
		mockLoadTokens.mockResolvedValue({ cloudflareToken: "cf-token" });
		mockCreateCloudflareProvider.mockRejectedValue(
			new Error("bad credentials"),
		);
		const exitSpy = mockProcessExit();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			provisionCommand.parseAsync(["cloudflare", "turbo-cache"], {
				from: "user",
			}),
		).rejects.toThrow("process.exit:1");

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

		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("fails offline when Cloudflare turbo-cache provisioning fails", async () => {
		const provider = { accountId: "account-1" };
		mockLoadTokens.mockResolvedValue({ cloudflareToken: "cf-token" });
		mockCreateCloudflareProvider.mockResolvedValue(provider);
		mockProvision.mockRejectedValue(new Error("wrangler failed"));
		const exitSpy = mockProcessExit();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			provisionCommand.parseAsync(
				[
					"cloudflare",
					"turbo-cache",
					"--bucket",
					"refarm-cache-test",
					"--team",
					"garden",
				],
				{ from: "user" },
			),
		).rejects.toThrow("process.exit:1");

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

		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
	});
});
