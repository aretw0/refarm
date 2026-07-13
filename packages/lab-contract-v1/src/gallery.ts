import type { TaskArtifactManifest, TaskArtifactReference } from "@refarm.dev/artifact-contract-v1";

/**
 * The GALLERY view-model — turn a Lab's artifact manifest into the items a gallery page renders
 * (a card per notebook + a list of datasets). Pure: a face (an Astro page, a TUI list, an app)
 * consumes these and does the DOM; this only shapes the data. Mirrors the vault-seed `/lab` page's
 * split (notebooks vs presentations vs datasets) without owning any UI.
 */

/** One notebook card in the gallery. `href` is the exported HTML the browser opens; `available`
 * starts false and a face flips it after a HEAD-probe (the notebook may not be exported yet). */
export interface LabGalleryNotebook {
	id: string;
	title: string;
	href: string;
	kind: "notebook" | "presentation";
	/** True only when the artifact carries a content hash — i.e. it was actually exported. */
	exported: boolean;
	hash?: string;
}

/** One dataset row in the gallery. */
export interface LabGalleryDataset {
	id: string;
	uri: string;
	mediaType: string;
	runtime: boolean;
}

export interface LabGallery {
	notebooks: LabGalleryNotebook[];
	presentations: LabGalleryNotebook[];
	datasets: LabGalleryDataset[];
}

function titleFromId(id: string): string {
	return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function notebookCard(artifact: TaskArtifactReference): LabGalleryNotebook {
	const isPresentation = artifact.labels?.includes("presentation") ?? false;
	return {
		id: artifact.id,
		title: titleFromId(artifact.id),
		href: artifact.uri,
		kind: isPresentation ? "presentation" : "notebook",
		exported: Boolean(artifact.hash),
		...(artifact.hash ? { hash: artifact.hash.value } : {}),
	};
}

/**
 * Build the gallery view-model from a Lab artifact manifest: notebook reports become cards (split
 * into notebooks vs presentations), datasets become rows. PURE — the face renders it. An
 * `exported` flag (from the presence of a content hash) tells the face which notebooks are ready,
 * so it can show "aguardando exportação" for the rest (or HEAD-probe the href to confirm).
 */
export function buildLabGallery(manifest: TaskArtifactManifest): LabGallery {
	const notebooks: LabGalleryNotebook[] = [];
	const presentations: LabGalleryNotebook[] = [];
	const datasets: LabGalleryDataset[] = [];
	for (const artifact of manifest.artifacts) {
		if (artifact.role === "report" && artifact.labels?.includes("notebook")) {
			const card = notebookCard(artifact);
			(card.kind === "presentation" ? presentations : notebooks).push(card);
		} else if (artifact.role === "dataset") {
			datasets.push({
				id: artifact.id,
				uri: artifact.uri,
				mediaType: artifact.mediaType,
				runtime: artifact.labels?.includes("runtime") ?? false,
			});
		}
	}
	return { notebooks, presentations, datasets };
}
