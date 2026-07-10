import {
	buttonHtml,
	cardHtml,
	documentHtml,
	escapeHtml,
	feedbackHtml,
	gridHtml,
	sectionHtml,
	tableHtml,
} from "@refarm.dev/ds/html";
import type { DsLintSnapshot } from "@refarm.dev/ds/lint";
import { createDsQualityChecker } from "@refarm.dev/ds/quality-checker";
import type { QualityProfile, QualityReport } from "@refarm.dev/quality-contract-v1";

export const LOCAL_SURFACE_SCHEMA = "local-surface.v1" as const;
export const LOCAL_SURFACE_CAPABILITY = "local-surface:v1" as const;

export interface LocalSurfacePanel {
	id: string;
	title: string;
	summary: string;
	kind: "dataset" | "form" | "receipt" | "activity" | "status";
	rows?: Array<Record<string, string | number | boolean | null>>;
}

export interface LocalSurfaceAction {
	id: string;
	label: string;
	kind: "navigate" | "submit" | "review" | "command";
	target?: string;
	requiresReview?: boolean;
}

export interface LocalSurfaceInput {
	id: string;
	title: string;
	description: string;
	routeBase?: string;
	theme?: string;
	storageNamespaces?: string[];
	panels: LocalSurfacePanel[];
	actions: LocalSurfaceAction[];
	evidence?: string[];
	boundaries?: string[];
}

export interface LocalSurfaceManifest {
	schema: typeof LOCAL_SURFACE_SCHEMA;
	capability: typeof LOCAL_SURFACE_CAPABILITY;
	id: string;
	title: string;
	description: string;
	routeBase: string;
	theme: string;
	localFirst: {
		mode: "local-only";
		storageNamespaces: string[];
		networkRequired: false;
	};
	panels: LocalSurfacePanel[];
	actions: LocalSurfaceAction[];
	evidence: string[];
	boundaries: string[];
}

export interface LocalSurfaceLaunchPlan {
	schema: "local-surface.launch-plan.v1";
	surfaceId: string;
	commandLabel: string;
	steps: Array<{
		id: string;
		command: string;
		purpose: string;
	}>;
	boundaries: string[];
}

export interface LocalSurfaceDocumentOptions {
	lang?: string;
	assetBase?: string;
}

export function createLocalSurfaceManifest(input: LocalSurfaceInput): LocalSurfaceManifest {
	return {
		schema: LOCAL_SURFACE_SCHEMA,
		capability: LOCAL_SURFACE_CAPABILITY,
		id: input.id,
		title: input.title,
		description: input.description,
		routeBase: normalizeRouteBase(input.routeBase ?? "/"),
		theme: input.theme ?? "tractor-green",
		localFirst: {
			mode: "local-only",
			storageNamespaces: [...(input.storageNamespaces ?? [])],
			networkRequired: false,
		},
		panels: input.panels.map((panel) => ({
			...panel,
			...(panel.rows ? { rows: panel.rows.map((row) => ({ ...row })) } : {}),
		})),
		actions: input.actions.map((action) => ({ ...action })),
		evidence: [...(input.evidence ?? [])],
		boundaries: [
			...(input.boundaries ?? []),
			"Surface generation does not start a server or claim provider integration.",
			"Command labels are white-label wrappers around the manifest shape.",
		],
	};
}

export function renderLocalSurfaceDocument(
	manifest: LocalSurfaceManifest,
	options: LocalSurfaceDocumentOptions = {},
): string {
	const panels = manifest.panels.map((panel) =>
		cardHtml({
			title: panel.title,
			rows: [
				`<p>${escapeHtml(panel.summary)}</p>`,
				`<p><strong>Kind:</strong> ${escapeHtml(panel.kind)}</p>`,
				...(panel.rows?.length
					? [
							tableHtml({
								headers: Object.keys(panel.rows[0] ?? {}),
								rows: panel.rows.map((row) =>
									Object.values(row).map((value) => String(value ?? "")),
								),
							}),
						]
					: []),
			],
		}),
	);
	const actions = manifest.actions.map((action) =>
		buttonHtml({
			label: action.label,
			variant: action.requiresReview ? "ghost" : "primary",
			attrs: {
				type: "button",
				"data-action-id": action.id,
				"data-action-kind": action.kind,
				...(action.target ? { "data-action-target": action.target } : {}),
				...(action.requiresReview ? { "data-requires-review": "true" } : {}),
			},
		}),
	);
	const storageRows = manifest.localFirst.storageNamespaces.map((namespace) => [
		namespace,
		"local-only",
		"no network required",
	]);
	const bodyHtml = `<main class="ds-shell local-surface" data-local-surface-id="${escapeHtml(manifest.id)}">
<header class="ds-section">
<h1>${escapeHtml(manifest.title)}</h1>
<p>${escapeHtml(manifest.description)}</p>
${feedbackHtml({ kind: "info", message: "Local-first surface manifest loaded." })}
</header>
${sectionHtml("Panels", gridHtml(panels))}
${sectionHtml("Actions", `<div class="ds-card__actions">${actions.join("")}</div>`)}
${sectionHtml(
	"Local Storage",
	storageRows.length
		? tableHtml({
				headers: ["Namespace", "Mode", "Network"],
				rows: storageRows,
			})
		: "<p>No storage namespaces declared.</p>",
)}
</main>`;

	return documentHtml({
		title: manifest.title,
		lang: options.lang,
		theme: manifest.theme,
		assetBase: options.assetBase,
		bodyHtml,
	});
}

export function buildLocalSurfaceLaunchPlan(
	manifest: LocalSurfaceManifest,
	options: { commandLabel?: string; port?: number; manifestPath?: string } = {},
): LocalSurfaceLaunchPlan {
	const commandLabel = options.commandLabel ?? "<white-label-cli>";
	const manifestPath = options.manifestPath ?? "local-surface.json";
	const port = options.port ?? 4177;
	return {
		schema: "local-surface.launch-plan.v1",
		surfaceId: manifest.id,
		commandLabel,
		steps: [
			{
				id: "doctor",
				command: `${commandLabel} doctor --local --json`,
				purpose: "confirm local runtime, storage, and DS asset availability",
			},
			{
				id: "render",
				command: `${commandLabel} web render ${manifestPath} --out ./public --json`,
				purpose: "materialize the static shell document from the manifest",
			},
			{
				id: "serve",
				command: `${commandLabel} web serve ./public --host 127.0.0.1 --port ${port} --json`,
				purpose: "launch a loopback-only local web surface",
			},
			{
				id: "handoff",
				command: `${commandLabel} web handoff ${manifestPath} --json`,
				purpose: "emit review evidence without requiring product branding",
			},
		],
		boundaries: [
			"The launch plan is a host contract; this package does not bind a concrete HTTP server.",
			"The surface is local-first and loopback-oriented; provider adapters remain consumer-owned.",
			"Brand, routes, screenshots, credentials, and real service integrations remain downstream.",
		],
	};
}

export function buildLocalSurfaceQualityProfile(): QualityProfile {
	return {
		name: "local-surface-ui",
		rules: [
			{
				id: "ds-contrast",
				severity: "fail",
				description: "Local surface text must keep concrete accessible contrast.",
				check: { type: "contrast" },
			},
			{
				id: "ds-overflow",
				severity: "fail",
				description: "Local surface regions must not overflow their viewport.",
				check: { type: "overflow" },
			},
			{
				id: "ds-fluid-type",
				severity: "fail",
				description: "Local surface headings must use bounded fluid type.",
				check: { type: "fluid-type" },
			},
			{
				id: "ds-heading-hierarchy",
				severity: "fail",
				description: "Local surface headings must remain navigable.",
				check: { type: "heading-hierarchy" },
			},
		],
	};
}

export function createLocalSurfaceQualitySnapshot(manifest: LocalSurfaceManifest): DsLintSnapshot {
	return {
		viewport: { width: 1280, height: 900 },
		elements: [
			textElement("surface-title", "h1", manifest.title, 32, "clamp(1.75rem, 2vw, 2rem)", {
				x: 32,
				y: 32,
				width: 720,
				height: 44,
			}),
			textElement("surface-description", "p", manifest.description, 16, "1rem", {
				x: 32,
				y: 88,
				width: 840,
				height: 28,
			}),
			textElement("surface-panels-heading", "h2", "Panels", 24, "clamp(1.25rem, 1.5vw, 1.5rem)", {
				x: 32,
				y: 160,
				width: 320,
				height: 34,
			}),
			...manifest.panels.map((panel, index) =>
				textElement(`panel-${panel.id}`, "h3", panel.title, 18, "clamp(1rem, 1.1vw, 1.125rem)", {
					x: 32 + (index % 3) * 320,
					y: 216 + Math.floor(index / 3) * 160,
					width: 280,
					height: 28,
				}),
			),
			textElement("surface-actions-heading", "h2", "Actions", 24, "clamp(1.25rem, 1.5vw, 1.5rem)", {
				x: 32,
				y: 560,
				width: 320,
				height: 34,
			}),
		],
	};
}

export async function checkLocalSurfaceQuality(
	manifest: LocalSurfaceManifest,
	profile: QualityProfile = buildLocalSurfaceQualityProfile(),
): Promise<QualityReport> {
	const checker = createDsQualityChecker();
	const findings = await checker.check(createLocalSurfaceQualitySnapshot(manifest), profile);
	const counts = findings.reduce<Record<string, number>>((acc, finding) => {
		acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
		return acc;
	}, {});
	return {
		capability: "quality:v1",
		checkerId: checker.checkerId,
		domain: checker.domain,
		profileName: profile.name,
		findings,
		counts,
		metrics: {
			panelCount: manifest.panels.length,
			actionCount: manifest.actions.length,
			storageNamespaceCount: manifest.localFirst.storageNamespaces.length,
		},
	};
}

function normalizeRouteBase(routeBase: string): string {
	const trimmed = routeBase.trim();
	if (!trimmed || trimmed === "/") return "/";
	return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function textElement(
	id: string,
	tagName: string,
	text: string,
	fontSizePx: number,
	fontSizeExpression: string,
	boundingBox: { x: number; y: number; width: number; height: number },
): DsLintSnapshot["elements"][number] {
	return {
		id,
		tagName,
		text,
		styles: {
			color: "#1c2b22",
			backgroundColor: "#ffffff",
			fontSizePx,
			fontSizeExpression,
		},
		metrics: {
			clientWidth: boundingBox.width,
			clientHeight: boundingBox.height,
			scrollWidth: boundingBox.width,
			scrollHeight: boundingBox.height,
			boundingBox,
		},
	};
}
