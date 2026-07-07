import {
	isCapabilityGroup,
	resolveGroupAction,
	type CapabilityEntry,
	type CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { createNotesboxRegistry } from "./registry.js";

/**
 * The T3 PERSONA extension proof — RESULT mode. The analyst runs ONE verb and gets a
 * finished requirements MOC (markdown product); they never touch the neutral
 * `records analyze` engine underneath. And because the persona view shares the same
 * records deps as `records correct`, a persisted review shows up in the MOC — the
 * product reflects the analyst's work.
 */
function reg() {
	return createNotesboxRegistry();
}

function group(r: ReturnType<typeof reg>, name: string): CapabilityGroup {
	const entry = r.list().find((e: CapabilityEntry) => e.name === name);
	if (!entry || !isCapabilityGroup(entry)) throw new Error(`no group ${name}`);
	return entry;
}

async function runGroup(
	r: ReturnType<typeof reg>,
	name: string,
	tokens: string[],
): Promise<Record<string, unknown>> {
	const resolved = resolveGroupAction(group(r, name), tokens);
	if (!resolved) throw new Error(`cannot resolve ${name} ${tokens.join(" ")}`);
	return (await resolved.action.run(resolved.input)) as unknown as Record<string, unknown>;
}

async function runVerb(
	r: ReturnType<typeof reg>,
	name: string,
	options: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	const entry = r.list().find((e) => e.name === name);
	if (!entry || isCapabilityGroup(entry)) throw new Error(`no verb ${name}`);
	return (await entry.run({ args: {}, options: options as never, json: true })) as unknown as Record<
		string,
		unknown
	>;
}

describe("T3 persona extension: requirements-moc (result mode over the neutral engine)", () => {
	it("projects the analyze envelope into a navigable requirements MOC (a product)", async () => {
		const r = reg();
		const env = await runVerb(r, "requirements-moc");
		expect(env.ok).toBe(true);
		const moc = env.moc as string;
		// The product is Obsidian markdown the analyst reads — headings + [[links]].
		expect(moc.startsWith("# Mapa de Conteúdo — Requisitos")).toBe(true);
		expect(moc).toContain("[["); // navigable links
		expect(env.total).toBe(2);
	});

	it("the MOC surfaces on the CLI like any verb (declare-once projection)", () => {
		const r = reg();
		const names = r.list().map((e) => e.name);
		expect(names).toContain("requirements-moc");
	});

	it("reflects an analyst's correction — the product shows the persisted review", async () => {
		const r = reg();
		// The analyst marks a requirement reviewed (persists via the shared records deps)...
		const corrected = await runGroup(r, "records", [
			"correct",
			"record:req-root",
			"reviewed",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);

		// ...and the requirements MOC (same shared state) now groups it under reviewed.
		const env = await runVerb(r, "requirements-moc");
		const moc = env.moc as string;
		// Both records are now "reviewed" → the reviewed section lists both.
		const reviewedSection = moc.slice(moc.indexOf("Requisitos revisados"));
		expect(reviewedSection).toContain("Requisito raiz");
		expect(reviewedSection).toContain("Requisito filho");
	});
});
