import { buildLabGallery } from "@refarm.dev/lab-contract-v1";
import type { TaskArtifactManifest } from "@refarm.dev/artifact-contract-v1";

import { reqbenchApp } from "../cli.js";

/**
 * The Lab GALLERY web face — lists the requirement Lab's notebooks (a card each) + datasets. It
 * runs the `requirements-lab` verb, takes its artifact:v1 manifest, and renders the gallery via
 * the substrate's buildLabGallery. Each notebook card HEAD-probes its exported HTML so it shows
 * "Disponível / Abrir" only when the notebook was actually exported — graceful when it wasn't.
 * The example writes no gallery logic; the view-model is @refarm.dev/lab-contract-v1.
 */
export async function bootLabGallery(): Promise<void> {
	const overlay = document.getElementById("loading-overlay");
	const mount = document.getElementById("lab-mount");
	try {
		const registry = reqbenchApp.registry();
		const entry = registry.get("requirements-lab");
		if (!entry || !("run" in entry) || typeof entry.run !== "function") {
			throw new Error("requirements-lab verb not found");
		}
		const result = (await entry.run({ args: {}, options: {}, json: true })) as unknown as {
			manifest?: TaskArtifactManifest;
		};
		if (!mount) throw new Error("no #lab-mount");
		if (!result.manifest) {
			mount.innerHTML = `<p class="refarm-muted">Nenhum Lab ainda — faça um <code>pull</code> primeiro.</p>`;
			overlay?.remove();
			return;
		}
		const gallery = buildLabGallery(result.manifest);
		mount.innerHTML = renderGallery(gallery);
		overlay?.remove();

		// HEAD-probe each notebook href: flip "aguardando" → "Abrir" when the export exists.
		for (const card of mount.querySelectorAll<HTMLElement>("[data-notebook-href]")) {
			const href = card.dataset.notebookHref!;
			void fetch(href, { method: "HEAD" })
				.then((r) => {
					if (r.ok) card.dataset.available = "1";
				})
				.catch(() => {});
		}
	} catch (error) {
		console.error("[reqbench-t3] lab boot failed", error);
		if (overlay) overlay.textContent = `Falha ao abrir o Lab: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function esc(value: string): string {
	return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function renderGallery(gallery: ReturnType<typeof buildLabGallery>): string {
	const card = (n: (typeof gallery.notebooks)[number]): string => `
		<article class="refarm-stack" data-notebook-href="${esc(n.href)}" ${n.exported ? 'data-available="1"' : ""}
			style="border: 1px solid var(--refarm-hairline, #ccc); border-radius: 8px; padding: 1rem;">
			<p class="refarm-eyebrow">${n.kind === "presentation" ? "Apresentação" : "Notebook"}</p>
			<h3>${esc(n.title)}</h3>
			<p class="refarm-muted" data-when-unavailable>Aguardando exportação…</p>
			<a href="${esc(n.href)}" data-when-available>Abrir →</a>
		</article>`;
	const notebooks = [...gallery.notebooks, ...gallery.presentations].map(card).join("");
	const datasets = gallery.datasets
		.map((d) => `<li><code>${esc(d.id)}</code> — ${esc(d.mediaType)}${d.runtime ? " (runtime)" : ""}</li>`)
		.join("");
	return `
		<style>
			[data-notebook-href] [data-when-available] { display: none; }
			[data-notebook-href][data-available="1"] [data-when-available] { display: inline; }
			[data-notebook-href][data-available="1"] [data-when-unavailable] { display: none; }
		</style>
		<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem;">${notebooks}</div>
		<section class="refarm-stack" style="margin-top: 1.5rem;">
			<p class="refarm-eyebrow">Datasets</p>
			<ul>${datasets}</ul>
		</section>`;
}
