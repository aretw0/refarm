export type TokenProvider = "github" | "cloudflare";
export type TokenFailureReason = "expired" | "invalid" | "revoked";

export class TokenAuthError extends Error {
	readonly provider: TokenProvider;
	readonly reason: TokenFailureReason;
	readonly rotationUrl: string;

	constructor(opts: {
		provider: TokenProvider;
		reason: TokenFailureReason;
		rotationUrl: string;
		message?: string;
	}) {
		super(opts.message ?? TokenAuthError.defaultMessage(opts.provider, opts.reason));
		this.name = "TokenAuthError";
		this.provider = opts.provider;
		this.reason = opts.reason;
		this.rotationUrl = opts.rotationUrl;
	}

	static forGithub(reason: TokenFailureReason, storedToken?: string): TokenAuthError {
		return new TokenAuthError({
			provider: "github",
			reason,
			rotationUrl: githubRotationUrl(storedToken),
		});
	}

	static forCloudflare(reason: TokenFailureReason): TokenAuthError {
		return new TokenAuthError({
			provider: "cloudflare",
			reason,
			rotationUrl: "https://dash.cloudflare.com/profile/api-tokens",
		});
	}

	private static defaultMessage(provider: TokenProvider, reason: TokenFailureReason): string {
		const label = provider === "github" ? "GitHub" : "Cloudflare";
		const verb =
			reason === "expired" ? "has expired" :
			reason === "revoked" ? "was revoked" :
			"is invalid";
		return `${label} token ${verb}.`;
	}
}

/** Route to fine-grained PAT settings for github_pat_ prefix, classic otherwise. */
export function githubRotationUrl(token?: string): string {
	return token?.startsWith("github_pat_")
		? "https://github.com/settings/personal-access-tokens"
		: "https://github.com/settings/tokens";
}
