import { describe, expect, it, vi } from "vitest";

import { createGitHubCopilotProvider } from "./github-copilot.js";

const DEVICE_CODE = {
	device_code: "dev-1",
	user_code: "ABCD-1234",
	verification_uri: "https://github.com/login/device",
	interval: 0,
	expires_in: 900,
};

const COPILOT_TOKEN = "tid=t1;exp=1700000000;proxy-ep=proxy.individual.githubcopilot.com";

function jsonResponse(body: unknown, ok = true): Response {
	return { ok, status: ok ? 200 : 401, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function callbacks() {
	return {
		onAuth: vi.fn(),
		onPrompt: vi.fn(async () => ""),
		onProgress: vi.fn(),
	};
}

describe("createGitHubCopilotProvider — identity", () => {
	it("uses the client id it is GIVEN, never one borrowed from another product", () => {
		// The whole reason this adapter exists rather than a copy of pi's. `Iv1.b507a08c87ecfe98` is
		// the Copilot editor-plugin family's id, and refarm may not claim it.
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: vi.fn() });
		expect(provider.id).toBe("github-copilot");
		expect(provider.usesCallbackServer).toBe(false);
	});

	it("asks for read:user and NOTHING else, so it cannot reach a repository", async () => {
		// The device response is deliberately unusable, so login refuses after the ONE call this
		// test inspects instead of entering the polling loop.
		const doFetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: doFetch as never });
		await expect(provider.login(callbacks())).rejects.toThrow(/device-code response/u);
		const init = doFetch.mock.calls[0]![1]!;
		expect(JSON.parse(String(init.body))).toMatchObject({
			client_id: "Ov23-refarm",
			scope: "read:user",
		});
	});

	it("sends NO impersonation headers", async () => {
		// pi sends `User-Agent: GitHubCopilotChat/0.35.0` and `Copilot-Integration-Id: vscode-chat`.
		// Whether GitHub honours an honest identity here is exactly what the operator's first login
		// measures, and it cannot measure it if we lie.
		const doFetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}));
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: doFetch as never });
		await expect(provider.login(callbacks())).rejects.toThrow();
		const init = doFetch.mock.calls[0]![1]!;
		const serialised = JSON.stringify(init.headers ?? {});
		expect(serialised).not.toMatch(/vscode|GitHubCopilotChat|Editor-Version/iu);
		expect(serialised).toMatch(/refarm/iu);
	});
});

describe("createGitHubCopilotProvider — login", () => {
	it("shows the operator the code and the URL, with no local server", async () => {
		// DEVICE FLOW, not a browser callback. That is what lets this login happen on a headless node
		// or from a phone, and it is a genuine advantage over the codex flow.
		const doFetch = vi.fn(async (url: string) => {
			if (String(url).includes("device/code")) return jsonResponse(DEVICE_CODE);
			if (String(url).includes("access_token")) return jsonResponse({ access_token: "gho_USER" });
			return jsonResponse({ token: COPILOT_TOKEN, expires_at: 1_700_000_000 });
		});
		const cb = callbacks();
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: doFetch as never });
		const creds = await provider.login(cb);
		expect(cb.onAuth).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://github.com/login/device" }),
		);
		expect(String(cb.onAuth.mock.calls[0]?.[0]?.instructions)).toContain("ABCD-1234");
		expect(creds.access).toBe(COPILOT_TOKEN);
		expect(creds.refresh).toBe("gho_USER");
	});

	it("keeps the DURABLE github token as the refresh material", async () => {
		// The Copilot token is short-lived and the GitHub user token is not. Storing the short one as
		// `refresh` would make every renewal fail once the first token expired.
		const doFetch = vi.fn(async (url: string) =>
			String(url).includes("device/code")
				? jsonResponse(DEVICE_CODE)
				: String(url).includes("access_token")
					? jsonResponse({ access_token: "gho_USER" })
					: jsonResponse({ token: COPILOT_TOKEN, expires_at: 1_700_000_000 }),
		);
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: doFetch as never });
		const creds = await provider.login(callbacks());
		expect(creds.refresh).toBe("gho_USER");
		expect(creds.expires).toBeLessThan(1_700_000_000 * 1000);
	});

	it("records the endpoint AND how it was decided", async () => {
		const doFetch = vi.fn(async (url: string) =>
			String(url).includes("device/code")
				? jsonResponse(DEVICE_CODE)
				: String(url).includes("access_token")
					? jsonResponse({ access_token: "gho_USER" })
					: jsonResponse({ token: COPILOT_TOKEN, expires_at: 1_700_000_000 }),
		);
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: doFetch as never });
		const creds = await provider.login(callbacks());
		expect(creds.baseUrl).toBe("https://api.individual.githubcopilot.com");
		expect(creds.baseUrlSource).toBe("from-token");
	});

	it("REFUSES the exchange by name when GitHub rejects this identity", async () => {
		// The measurement the operator's first login exists to make. If GitHub only honours known
		// integration ids, this is where it shows, and it must say so rather than surface a raw
		// status code.
		const doFetch = vi.fn(async (url: string) =>
			String(url).includes("device/code")
				? jsonResponse(DEVICE_CODE)
				: String(url).includes("access_token")
					? jsonResponse({ access_token: "gho_USER" })
					: jsonResponse({ message: "Forbidden" }, false),
		);
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: doFetch as never });
		await expect(provider.login(callbacks())).rejects.toThrow(/did not accept|copilot_internal/iu);
	});
});

describe("createGitHubCopilotProvider — refresh", () => {
	it("exchanges the durable github token again rather than re-authenticating", async () => {
		const doFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
			jsonResponse({ token: "tid=t2;proxy-ep=proxy.x.com", expires_at: 1_800_000_000 }),
		);
		const provider = createGitHubCopilotProvider({ clientId: "Ov23-refarm", fetch: doFetch as never });
		const next = await provider.refreshToken({ access: "old", refresh: "gho_USER", expires: 0 });
		expect(next.access).toBe("tid=t2;proxy-ep=proxy.x.com");
		expect(next.refresh).toBe("gho_USER");
		const init = doFetch.mock.calls[0]![1]!;
		expect(JSON.stringify(init.headers)).toContain("gho_USER");
	});
});
