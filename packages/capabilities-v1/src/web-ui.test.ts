import {
	createCapabilityRegistry,
	type CapabilityDescriptor,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import {
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	type CapabilityDeps,
} from "./index.js";
import { mountCapabilities } from "./mount.js";
import { surfaceModel } from "./surface-model.js";
import { renderWebUi, serveWebUi } from "./web-ui.js";

const walletVerb: CapabilityDescriptor = {
	name: "wallet-show",
	summary: "Show my wallet",
	transports: { http: { method: "GET", path: "/wallet" } },
	renderers: { web: { route: "/wallet", icon: "wallet" }, tui: { section: "citizen" } },
	run: () => ({ ok: true, total: 3 }) as never,
};

function deps(): CapabilityDeps {
	return {
		source: defaultSourceDeps(),
		vault: defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async (e) => e.id,
		}),
		records: defaultRecordsDeps(),
	};
}

describe("renderWebUi — the surface model as an HTML dashboard", () => {
	it("renders a card for each web verb, with its endpoint + title", () => {
		const registry = createCapabilityRegistry([walletVerb]);
		const html = renderWebUi(surfaceModel(registry), {
			title: "My Wallet",
			subtitle: "sovereign",
		});
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain("My Wallet");
		expect(html).toContain("wallet-show");
		expect(html).toContain("Show my wallet");
		// The card carries the invocation endpoint (GET /capabilities/wallet).
		expect(html).toContain('data-method="GET"');
		expect(html).toContain('data-path="/capabilities/wallet"');
	});

	it("is theme-aware (light + dark tokens) and self-contained (no external assets)", () => {
		const html = renderWebUi({ sections: [] });
		expect(html).toContain("prefers-color-scheme: dark");
		expect(html).toContain('data-theme="dark"');
		expect(html).not.toMatch(/https?:\/\/[^"]+\.(css|js)/); // no external stylesheet/script
	});
});

describe("serveWebUi — the live web surface", () => {
	it("serves the dashboard at / and a verb's endpoint under the prefix", async () => {
		const registry = mountCapabilities({ deps: deps(), verbs: [walletVerb] });
		const { listening, close } = serveWebUi(registry, { port: 0, title: "My Wallet" });
		try {
			const { port } = await listening;
			// The dashboard HTML.
			const page = await fetch(`http://127.0.0.1:${port}/`);
			expect(page.headers.get("content-type")).toContain("text/html");
			const html = await page.text();
			expect(html).toContain("My Wallet");
			expect(html).toContain("wallet-show");

			// The verb's JSON endpoint (delegated to the http handler) still works.
			const api = await fetch(`http://127.0.0.1:${port}/capabilities/wallet`);
			expect(api.status).toBe(200);
			const body = (await api.json()) as { ok: boolean; total: number };
			expect(body.ok).toBe(true);
			expect(body.total).toBe(3);
		} finally {
			await close();
		}
	});

	async function repl(port: number, line: string) {
		const res = await fetch(`http://127.0.0.1:${port}/repl`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ line }),
		});
		return (await res.json()) as { ok: boolean; reply?: string; result?: unknown };
	}

	it("the REPL runs the SAME grammar as the TUI — a /verb dispatches it", async () => {
		const registry = mountCapabilities({ deps: deps(), verbs: [walletVerb] });
		const { listening, close } = serveWebUi(registry, { port: 0 });
		try {
			const { port } = await listening;
			// A slash-verb dispatches the verb (parseChatLine → capability).
			const out = await repl(port, "/wallet-show");
			expect(out.ok).toBe(true);
			expect((out.result as { total: number }).total).toBe(3);

			// /help lists the verbs — the coherent base every surface shares.
			const help = await repl(port, "/help");
			expect(help.reply).toContain("/wallet-show");
		} finally {
			await close();
		}
	});

	it("free text goes to the injected agent; absent → 'not connected' (verbs still work)", async () => {
		const registry = mountCapabilities({ deps: deps(), verbs: [walletVerb] });

		// With an injected agent:
		const withAgent = serveWebUi(registry, {
			port: 0,
			sendPrompt: async (text) => `agent heard: ${text}`,
		});
		try {
			const { port } = await withAgent.listening;
			const out = await repl(port, "how is my wallet?");
			expect(out.ok).toBe(true);
			expect(out.reply).toBe("agent heard: how is my wallet?");
		} finally {
			await withAgent.close();
		}

		// Without an injected agent — the REPL is honest, verbs still work.
		const noAgent = serveWebUi(registry, { port: 0 });
		try {
			const { port } = await noAgent.listening;
			const msg = await repl(port, "hello");
			expect(msg.reply).toContain("not connected");
			const verb = await repl(port, "/wallet-show");
			expect(verb.ok).toBe(true); // the verb half needs no agent
		} finally {
			await noAgent.close();
		}
	});
});
