import { describe, expect, it } from "vitest";

import {
	buildLocalSurfaceLaunchPlan,
	checkLocalSurfaceQuality,
	createLocalSurfaceManifest,
	renderLocalSurfaceDocument,
} from "./index.js";

function fixtureManifest() {
	return createLocalSurfaceManifest({
		id: "wallet-demo",
		title: "Local Wallet",
		description: "Review credentials, authorization receipts, and revocation locally.",
		routeBase: "wallet",
		storageNamespaces: ["credentials", "receipts"],
		panels: [
			{
				id: "credentials",
				title: "Credentials",
				summary: "Credential records stored in a local namespace.",
				kind: "dataset",
				rows: [{ label: "Credential", status: "ready" }],
			},
			{
				id: "receipts",
				title: "Receipts",
				summary: "Reviewable authorization and revocation receipts.",
				kind: "receipt",
			},
		],
		actions: [
			{
				id: "review-request",
				label: "Review Request",
				kind: "review",
				requiresReview: true,
			},
			{
				id: "open-receipts",
				label: "Open Receipts",
				kind: "navigate",
				target: "/wallet/receipts",
			},
		],
		evidence: ["task-artifacts.json"],
	});
}

describe("local surface", () => {
	it("builds a local-first manifest without binding provider details", () => {
		const manifest = fixtureManifest();

		expect(manifest.schema).toBe("local-surface.v1");
		expect(manifest.capability).toBe("local-surface:v1");
		expect(manifest.routeBase).toBe("/wallet");
		expect(manifest.localFirst).toEqual({
			mode: "local-only",
			storageNamespaces: ["credentials", "receipts"],
			networkRequired: false,
		});
		expect(manifest.boundaries.join("\n")).toContain("Surface generation does not start a server");
		expect(manifest.boundaries.join("\n")).toContain("white-label wrappers");
	});

	it("renders DS-backed HTML and escapes consumer data", () => {
		const manifest = createLocalSurfaceManifest({
			...fixtureManifest(),
			title: "Local <Wallet>",
		});
		const html = renderLocalSurfaceDocument(manifest, { assetBase: "/assets/ds" });

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("/assets/ds/tokens.css");
		expect(html).toContain("Local &lt;Wallet&gt;");
		expect(html).toContain('data-action-id="review-request"');
		expect(html).toContain('data-requires-review="true"');
		expect(html).toContain("credentials");
	});

	it("creates a white-label launch plan", () => {
		const plan = buildLocalSurfaceLaunchPlan(fixtureManifest(), {
			commandLabel: "vault",
			port: 4222,
			manifestPath: "shell.json",
		});

		expect(plan.schema).toBe("local-surface.launch-plan.v1");
		expect(plan.surfaceId).toBe("wallet-demo");
		expect(plan.steps.map((step) => step.id)).toEqual(["doctor", "render", "serve", "handoff"]);
		expect(plan.steps[2]?.command).toBe(
			"vault web serve ./public --host 127.0.0.1 --port 4222 --json",
		);
		expect(plan.boundaries.join("\n")).toContain("provider adapters remain consumer-owned");
	});

	it("emits a passing ds quality report for the deterministic surface snapshot", async () => {
		const report = await checkLocalSurfaceQuality(fixtureManifest());

		expect(report.capability).toBe("quality:v1");
		expect(report.checkerId).toBe("ds-lint");
		expect(report.findings).toEqual([]);
		expect(report.metrics).toMatchObject({
			panelCount: 2,
			actionCount: 2,
			storageNamespaceCount: 2,
		});
	});
});

describe("table rendering aligns values to their header", () => {
	it("keeps a value under its own column when rows declare keys in a different order", () => {
		// Objetos JS preservam ordem de inserção, e rows vindas de fontes distintas
		// chegam com ordens distintas. Emitir Object.values() por linha desalinha os
		// valores sem que a tabela pareça errada.
		const manifest = createLocalSurfaceManifest({
			id: "align",
			title: "Align",
			description: "Rows with the same keys in different orders.",
			actions: [],
			panels: [
				{
					id: "p",
					title: "P",
					summary: "s",
					kind: "activity",
					rows: [
						{ metrica: "primeira", valor: 1 },
						{ valor: 2, metrica: "segunda" },
					],
				},
			],
		});
		const html = renderLocalSurfaceDocument(manifest);
		expect(html).toContain("<td>segunda</td><td>2</td>");
		expect(html).not.toContain("<td>2</td><td>segunda</td>");
	});

	it("gives every key a column instead of dropping what the first row lacks", () => {
		const manifest = createLocalSurfaceManifest({
			id: "union",
			title: "Union",
			description: "Rows that do not declare the same keys.",
			actions: [],
			panels: [
				{
					id: "p",
					title: "P",
					summary: "s",
					kind: "activity",
					rows: [{ a: 1 }, { b: 2 }],
				},
			],
		});
		const html = renderLocalSurfaceDocument(manifest);
		expect(html).toContain("<th>a</th>");
		expect(html).toContain("<th>b</th>");
		// A célula ausente fica vazia, em vez de puxar o valor da coluna vizinha.
		expect(html).toContain("<td>1</td><td></td>");
		expect(html).toContain("<td></td><td>2</td>");
	});
});

describe("actions is optional", () => {
	it("builds a read-only surface without declaring actions", () => {
		const manifest = createLocalSurfaceManifest({
			id: "read-only",
			title: "Read Only",
			description: "A surface that offers nothing to click.",
			panels: [{ id: "p", title: "P", summary: "s", kind: "activity" }],
		} as Parameters<typeof createLocalSurfaceManifest>[0]);
		expect(manifest.actions).toEqual([]);
		expect(() => renderLocalSurfaceDocument(manifest)).not.toThrow();
	});
});
