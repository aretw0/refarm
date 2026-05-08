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
}));

import { provisionCommand } from "../../src/commands/provision.js";

describe("provision command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});
