export interface OAuthCredentials {
	access: string;
	refresh: string;
	/** Unix ms timestamp after which access token should be refreshed. */
	expires: number;
	[key: string]: unknown;
}

export interface OAuthPrompt {
	message: string;
	placeholder?: string;
}

export interface OAuthLoginCallbacks {
	/** Called with the browser URL to open and optional instructions. */
	onAuth: (info: { url: string; instructions?: string }) => void;
	/** Called to prompt user for manual code paste (fallback). */
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	/** Optional progress messages during token exchange. */
	onProgress?: (message: string) => void;
	/**
	 * Optional: resolves with user-pasted code/URL while the browser
	 * callback server runs concurrently. Whichever arrives first wins.
	 */
	onManualCodeInput?: () => Promise<string>;
	/**
	 * When true, the provider must skip starting a local callback HTTP server
	 * and rely solely on onManualCodeInput / onPrompt for the code.
	 * Use when the environment cannot receive browser redirects (e.g. containers).
	 */
	skipCallbackServer?: boolean;
}

export interface OAuthProviderInterface {
	readonly id: string;
	readonly name: string;
	/** True when the provider uses a local callback HTTP server. */
	readonly usesCallbackServer?: boolean;
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
	refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
	/** Extract API key string from credentials (often just `credentials.access`). */
	getApiKey(credentials: OAuthCredentials): string;
}
