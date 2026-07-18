import { mountCapabilityWebView } from "@refarm.dev/capability-homestead-surface/boot";
import { buildLabGallery } from "@refarm.dev/lab-contract-v1";
import type { TaskArtifactManifest } from "@refarm.dev/artifact-contract-v1";

import { createLabWebRegistry } from "./lab-app.js";

/** The `requirements-lab` verb's projection — the Lab's artifact:v1 manifest. */
type LabResult = { manifest?: TaskArtifactManifest };

/**
 * The Lab GALLERY web face — lists the requirement Lab's notebooks (a card each) + datasets. It
 * runs the `requirements-lab` verb, takes its artifact:v1 manifest, and renders the gallery via
 * the substrate's buildLabGallery. A notebook card shows "Abrir" only when the manifest marks it
 * exported (it carries a content hash); otherwise "Aguardando exportação…" — the manifest is the
 * single source of truth, recomputed live from the corpus on every boot, so no runtime probe is
 * needed. The example writes no gallery logic AND no boot boilerplate: the view-model is
 * @refarm.dev/lab-contract-v1, and the overlay lifecycle + empty state + error display are the
 * framework's mountCapabilityWebView. The registry is browser-safe (lab-app.ts → ../lab.ts), so
 * this boots in a real browser with no node/WASM in the bundle (nothing from ../cli.js).
 */
export async function bootLabGallery(): Promise<void> {
	await mountCapabilityWebView<LabResult>({
		namespace: "reqbench-t3",
		registry: createLabWebRegistry(),
		content: { verb: "requirements-lab" },
		errorLabel: "Falha ao abrir o Lab",
		view: {
			mount: "lab-mount",
			isEmpty: (r) => !r.manifest,
			emptyHtml: `<p class="refarm-muted">Nenhum Lab ainda — faça um <code>pull</code> primeiro.</p>`,
			render: ({ result, mount }) => {
				const gallery = buildLabGallery(result.manifest!); // isEmpty guards manifest presence
				mount.innerHTML = renderGallery(gallery);
			},
		},
	});
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
