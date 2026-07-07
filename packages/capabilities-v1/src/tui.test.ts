import {
	createCapabilityRegistry,
	type CapabilityDescriptor,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { handleTuiLine, renderTuiMenu } from "./tui.js";

const walletVerb: CapabilityDescriptor = {
	name: "wallet-show",
	summary: "Show my wallet",
	renderers: { tui: { section: "citizen", shortcut: "ctrl+w" } },
	run: () => ({ ok: true, total: 3 }) as never,
};

const analyzeVerb: CapabilityDescriptor = {
	name: "analyze",
	summary: "Analyze records",
	renderers: { tui: { section: "citizen" } },
	run: () => ({ ok: true }) as never,
};

function reg() {
	return createCapabilityRegistry([walletVerb, analyzeVerb]);
}
const names = new Set(["wallet-show", "analyze"]);

describe("renderTuiMenu — the surface model as a terminal menu", () => {
	it("lists sections + verbs with summaries and shortcuts", () => {
		const menu = renderTuiMenu(reg());
		expect(menu).toContain("CITIZEN");
		expect(menu).toContain("/wallet-show — Show my wallet");
		expect(menu).toContain("[ctrl+w]");
		expect(menu).toContain("/analyze — Analyze records");
	});

	it("is empty-safe when no verb declares a surface", () => {
		expect(renderTuiMenu(createCapabilityRegistry([]))).toContain("No verb declares");
	});
});

describe("handleTuiLine — the SAME grammar as the web REPL (one engine)", () => {
	it("a /verb dispatches the verb", async () => {
		const res = await handleTuiLine("/wallet-show", reg(), names);
		expect(res.close).toBeFalsy();
		expect(JSON.parse(res.output)).toMatchObject({ ok: true, total: 3 });
	});

	it("/help renders the menu", async () => {
		const res = await handleTuiLine("/help", reg(), names);
		expect(res.output).toContain("/wallet-show");
	});

	it("/exit closes the loop", async () => {
		const res = await handleTuiLine("/exit", reg(), names);
		expect(res.close).toBe(true);
	});

	it("free text goes to the injected agent", async () => {
		const res = await handleTuiLine("how is my wallet?", reg(), names, async (t) => `agent: ${t}`);
		expect(res.output).toBe("agent: how is my wallet?");
	});

	it("free text with no agent is honest (verbs still work)", async () => {
		const msg = await handleTuiLine("hello", reg(), names);
		expect(msg.output).toContain("not connected");
		const verb = await handleTuiLine("/analyze", reg(), names);
		expect(JSON.parse(verb.output)).toMatchObject({ ok: true });
	});

	it("an unknown verb reports cleanly", async () => {
		const res = await handleTuiLine("/nope", reg(), new Set(["nope"]));
		expect(res.output).toContain("unknown verb: nope");
	});
});
