import { describe, expect, it } from "vitest";
import { TokenAuthError, githubRotationUrl } from "./token-auth-error.js";

describe("TokenAuthError", () => {
	it("is an instance of Error", () => {
		const err = TokenAuthError.forCloudflare("invalid");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(TokenAuthError);
		expect(err.name).toBe("TokenAuthError");
	});

	it("carries provider, reason, rotationUrl", () => {
		const err = TokenAuthError.forCloudflare("expired");
		expect(err.provider).toBe("cloudflare");
		expect(err.reason).toBe("expired");
		expect(err.rotationUrl).toBe("https://dash.cloudflare.com/profile/api-tokens");
	});

	it("generates a default message from provider and reason", () => {
		expect(TokenAuthError.forCloudflare("expired").message).toBe("Cloudflare token has expired.");
		expect(TokenAuthError.forCloudflare("revoked").message).toBe("Cloudflare token was revoked.");
		expect(TokenAuthError.forCloudflare("invalid").message).toBe("Cloudflare token is invalid.");
		expect(TokenAuthError.forGithub("expired").message).toBe("GitHub token has expired.");
	});

	it("accepts a custom message override", () => {
		const err = new TokenAuthError({
			provider: "github",
			reason: "invalid",
			rotationUrl: "https://github.com/settings/tokens",
			message: "Custom error message",
		});
		expect(err.message).toBe("Custom error message");
	});
});

describe("TokenAuthError.forGithub", () => {
	const statelessInstallationToken = `ghs_${"a".repeat(180)}.${"b".repeat(180)}.${"c".repeat(180)}`;

	it("routes fine-grained PAT prefix to personal-access-tokens URL", () => {
		const err = TokenAuthError.forGithub("expired", "github_pat_abc123");
		expect(err.rotationUrl).toBe("https://github.com/settings/personal-access-tokens");
	});

	it("routes classic PAT (ghp_ prefix) to tokens URL", () => {
		const err = TokenAuthError.forGithub("expired", "ghp_abc123");
		expect(err.rotationUrl).toBe("https://github.com/settings/tokens");
	});

	it("routes unknown prefix to classic tokens URL", () => {
		const err = TokenAuthError.forGithub("invalid", "gho_oauth_token");
		expect(err.rotationUrl).toBe("https://github.com/settings/tokens");
	});

	it("keeps GitHub App installation tokens opaque", () => {
		const err = TokenAuthError.forGithub("expired", statelessInstallationToken);
		expect(err.rotationUrl).toBe("https://github.com/settings/tokens");
	});

	it("routes when no token provided to classic tokens URL", () => {
		const err = TokenAuthError.forGithub("invalid");
		expect(err.rotationUrl).toBe("https://github.com/settings/tokens");
	});
});

describe("githubRotationUrl", () => {
	it("returns fine-grained URL for github_pat_ prefix", () => {
		expect(githubRotationUrl("github_pat_xyz")).toBe(
			"https://github.com/settings/personal-access-tokens",
		);
	});

	it("returns classic URL for any other prefix", () => {
		expect(githubRotationUrl("ghp_xyz")).toBe("https://github.com/settings/tokens");
		expect(githubRotationUrl(undefined)).toBe("https://github.com/settings/tokens");
	});

	it("does not reject long JWT-shaped installation tokens", () => {
		const token = `ghs_${"a".repeat(180)}.${"b".repeat(180)}.${"c".repeat(180)}`;
		expect(githubRotationUrl(token)).toBe("https://github.com/settings/tokens");
	});
});
