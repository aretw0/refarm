import { describe, it, expect, vi } from "vitest";
import { anthropicOAuthProvider } from "./anthropic.js";

describe("anthropicOAuthProvider", () => {
	it("has correct id and name", () => {
		expect(anthropicOAuthProvider.id).toBe("anthropic");
		expect(anthropicOAuthProvider.name).toBe("Anthropic Claude (Pro/Max)");
	});

	it("uses callback server", () => {
		expect(anthropicOAuthProvider.usesCallbackServer).toBe(true);
	});

	it("getApiKey returns the access token", () => {
		const creds = { access: "tok_abc", refresh: "ref_xyz", expires: Date.now() + 3600_000 };
		expect(anthropicOAuthProvider.getApiKey(creds)).toBe("tok_abc");
	});

	it("refreshToken calls the token endpoint and returns updated credentials", async () => {
		const mockResponse = {
			access_token: "new_access",
			refresh_token: "new_refresh",
			expires_in: 3600,
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
			ok: true,
			text: async () => JSON.stringify(mockResponse),
		}));

		const result = await anthropicOAuthProvider.refreshToken({
			access: "old_access",
			refresh: "old_refresh",
			expires: 0,
		});

		expect(result.access).toBe("new_access");
		expect(result.refresh).toBe("new_refresh");
		expect(result.expires).toBeGreaterThan(Date.now());

		vi.unstubAllGlobals();
	});
});
