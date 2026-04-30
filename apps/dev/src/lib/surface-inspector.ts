import {
	listMountedHomesteadSurfaces,
	type MountedHomesteadSurface,
} from "@refarm.dev/homestead/sdk/surface-inspector";

export function mountedSurfaceLabel(surface: MountedHomesteadSurface): string {
	if (surface.surfaceId) {
		return `${surface.pluginId} · ${surface.surfaceId} → ${surface.slotId}`;
	}
	return `${surface.pluginId} · ${surface.mountSource} → ${surface.slotId}`;
}

export function mountStudioSurfaceInspector(
	container: HTMLElement,
	root: ParentNode = document,
): HTMLElement {
	container
		.querySelector<HTMLElement>("[data-refarm-studio-surface-inspector]")
		?.remove();

	const surfaces = listMountedHomesteadSurfaces(root);
	const details = document.createElement("details");
	details.dataset.refarmStudioSurfaceInspector = "true";
	details.className = "refarm-surface-card";
	details.style.marginTop = "0.75rem";
	details.style.maxWidth = "min(32rem, 80vw)";

	const summary = document.createElement("summary");
	summary.className = "refarm-card-title";
	summary.textContent = `${surfaces.length} mounted surface${surfaces.length === 1 ? "" : "s"}`;
	details.appendChild(summary);

	const list = document.createElement("ul");
	list.className = "refarm-stack";
	list.style.margin = "0.75rem 0 0";
	list.style.paddingLeft = "1rem";

	if (surfaces.length === 0) {
		const item = document.createElement("li");
		item.className = "refarm-card-body";
		item.textContent = "No plugin surfaces are mounted yet.";
		list.appendChild(item);
	} else {
		for (const surface of surfaces) {
			list.appendChild(renderSurfaceListItem(surface));
		}
	}

	details.appendChild(list);
	container.appendChild(details);
	return details;
}

export interface StudioSurfaceTelemetryEvent {
	event: string;
}

export interface StudioSurfaceTelemetrySource {
	observe(
		listener: (event: StudioSurfaceTelemetryEvent) => void,
	): (() => void) | void;
}

export interface StudioSurfaceInspectorController {
	readonly element: HTMLElement;
	refresh(): HTMLElement;
	dispose(): void;
}

export function mountReactiveStudioSurfaceInspector(
	container: HTMLElement,
	options: {
		root?: ParentNode;
		telemetry?: StudioSurfaceTelemetrySource;
	} = {},
): StudioSurfaceInspectorController {
	const root = options.root ?? document;
	let currentElement = mountStudioSurfaceInspector(container, root);

	const refresh = () => {
		const wasOpen = currentElement.hasAttribute("open");
		currentElement = mountStudioSurfaceInspector(container, root);
		if (wasOpen) currentElement.setAttribute("open", "");
		return currentElement;
	};

	const disposeTelemetry = options.telemetry?.observe((event) => {
		if (event.event === "ui:surface_mounted") refresh();
		if (event.event === "system:plugin_state_changed") refresh();
	});

	return {
		get element() {
			return currentElement;
		},
		refresh,
		dispose() {
			if (typeof disposeTelemetry === "function") disposeTelemetry();
		},
	};
}

function renderSurfaceListItem(
	surface: MountedHomesteadSurface,
): HTMLLIElement {
	const item = document.createElement("li");
	item.className = "refarm-card-body";

	const label = document.createElement("span");
	label.textContent = mountedSurfaceLabel(surface);
	item.appendChild(label);

	if (surface.surfaceKind || surface.state) {
		const metadata = document.createElement("span");
		metadata.className = "refarm-pill-meta";
		metadata.style.marginLeft = "0.5rem";
		metadata.textContent = [surface.surfaceKind, surface.state]
			.filter(Boolean)
			.join(" · ");
		item.appendChild(metadata);
	}

	return item;
}
