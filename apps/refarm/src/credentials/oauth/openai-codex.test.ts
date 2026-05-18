import { describe, it, expect, vi } from "vitest";
import { openaiCodexOAuthProvider } from "./openai-codex.js";

describe("openaiCodexOAuthProvider", () => {
	it("has correct id and name", () => {
		expect(openaiCodexOAuthProvider.id).toBe("openai-codex");
		expect(openaiCodexOAuthProvider.name).toBe("OpenAI Codex (ChatGPT sign-in)");
	});

	it("uses callback server", () => {
		expect(openaiCodexOAuthProvider.usesCallbackServer).toBe(true);
	});

	it("getApiKey returns the access token", () => {
		const creds = { access: "ey_abc", refresh: "ref_xyz", expires: Date.now() + 3600_000 };
		expect(openaiCodexOAuthProvider.getApiKey(creds)).toBe("ey_abc");
	});

	it("refreshToken calls the token endpoint and returns updated credentials", async () => {
		const mockJwt = `header.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_123" } }))}.sig`;
		const mockResponse = { access_token: mockJwt, refresh_token: "new_ref", expires_in: 3600 };
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		}));

		const result = await openaiCodexOAuthProvider.refreshToken({
			access: "old_tok",
			refresh: "old_ref",
			expires: 0,
		});

		expect(result.access).toBe(mockJwt);
		expect(result.refresh).toBe("new_ref");
		expect(result.expires).toBeGreaterThan(Date.now());
		vi.unstubAllGlobals();
	});
});
