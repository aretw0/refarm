import { describe, expect, it } from "vitest";

import { buildLabManifest, type LabCatalog } from "./catalog.js";
import { buildLabGallery } from "./gallery.js";

const catalog: LabCatalog = {
	notebooks: [
		{ id: "analise-grafo", title: "Análise", source: "lab/analise-grafo.py", output: "analise-grafo.html" },
		{ id: "visao-geral", title: "Visão", source: "lab/visao-geral.py", output: "visao-geral.html", type: "presentation" },
	],
	datasets: [
		{ id: "grafo", title: "Grafo", source: ".dgk/grafo.json", output: "grafo.json", format: "json" },
		{ id: "feed", title: "Feed", runtimeUrl: "https://example.invalid/feed", output: "feed.json", format: "json" },
	],
};

describe("buildLabGallery", () => {
	it("splits notebooks from presentations and lists datasets", () => {
		const manifest = buildLabManifest(catalog, { producer: "t", producedAt: "2026-07-13T00:00:00Z" });
		const gallery = buildLabGallery(manifest);
		expect(gallery.notebooks.map((n) => n.id)).toEqual(["analise-grafo"]);
		expect(gallery.presentations.map((n) => n.id)).toEqual(["visao-geral"]);
		expect(gallery.datasets.map((d) => d.id).sort()).toEqual(["feed", "grafo"]);
		expect(gallery.datasets.find((d) => d.id === "feed")?.runtime).toBe(true);
	});

	it("marks a notebook exported only when its artifact carries a hash", () => {
		const planned = buildLabGallery(buildLabManifest(catalog, { producer: "t", producedAt: "2026-07-13T00:00:00Z" }));
		expect(planned.notebooks[0]!.exported).toBe(false);

		const exported = buildLabGallery(
			buildLabManifest(catalog, {
				producer: "t",
				producedAt: "2026-07-13T00:00:00Z",
				hashes: { "analise-grafo": { algorithm: "sha256", value: "abc" } },
			}),
		);
		expect(exported.notebooks[0]!.exported).toBe(true);
		expect(exported.notebooks[0]!.hash).toBe("abc");
	});

	it("carries the notebook href (the exported HTML the browser opens)", () => {
		const gallery = buildLabGallery(buildLabManifest(catalog, { producer: "t", producedAt: "2026-07-13T00:00:00Z" }));
		expect(gallery.notebooks[0]!.href).toBe("lab/analise-grafo.html");
	});
});
