import {
	isHomesteadSurfaceChangeEvent,
	listRejectedHomesteadSurfaces,
	listMountedHomesteadSurfaces,
	mountedHomesteadSurfaceKey,
	type HomesteadSurfaceTelemetrySource,
	type HomesteadSurfaceTelemetryEvent,
	type MountedHomesteadSurface,
	type RejectedHomesteadSurfaceActivation,
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
	options: { telemetryEvents?: readonly HomesteadSurfaceTelemetryEvent[] } = {},
): HTMLElement {
	container
		.querySelector<HTMLElement>("[data-refarm-studio-surface-inspector]")
		?.remove();

	const surfaces = listMountedHomesteadSurfaces(root);
	const rejectedSurfaces = listRejectedHomesteadSurfaces(
		options.telemetryEvents ?? [],
	);
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
	if (rejectedSurfaces.length > 0) {
		details.appendChild(renderRejectedSurfaceList(rejectedSurfaces));
	}
	container.appendChild(details);
	return details;
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
		telemetry?: HomesteadSurfaceTelemetrySource;
		telemetryEvents?: readonly HomesteadSurfaceTelemetryEvent[];
	} = {},
): StudioSurfaceInspectorController {
	const root = options.root ?? document;
	const telemetryEvents = [...(options.telemetryEvents ?? [])];
	let currentElement = mountStudioSurfaceInspector(container, root, {
		telemetryEvents,
	});

	const refresh = () => {
		const wasOpen = currentElement.hasAttribute("open");
		currentElement = mountStudioSurfaceInspector(container, root, {
			telemetryEvents,
		});
		if (wasOpen) currentElement.setAttribute("open", "");
		return currentElement;
	};

	const disposeTelemetry = options.telemetry?.observe((event) => {
		if (event.event === "ui:surface_rejected") {
			telemetryEvents.push(event);
			refresh();
			return;
		}

		if (isHomesteadSurfaceChangeEvent(event)) refresh();
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

function renderRejectedSurfaceList(
	rejectedSurfaces: RejectedHomesteadSurfaceActivation[],
): HTMLElement {
	const section = document.createElement("section");
	section.className = "refarm-stack";
	section.style.marginTop = "0.75rem";

	const title = document.createElement("strong");
	title.className = "refarm-card-title";
	title.textContent = `${rejectedSurfaces.length} rejected surface${rejectedSurfaces.length === 1 ? "" : "s"}`;
	section.appendChild(title);

	const list = document.createElement("ul");
	list.className = "refarm-stack";
	list.style.margin = "0";
	list.style.paddingLeft = "1rem";
	for (const surface of rejectedSurfaces) {
		list.appendChild(renderRejectedSurfaceListItem(surface));
	}
	section.appendChild(list);
	return section;
}

function renderRejectedSurfaceListItem(
	surface: RejectedHomesteadSurfaceActivation,
): HTMLLIElement {
	const item = document.createElement("li");
	item.className = "refarm-card-body";
	const name = [surface.pluginId, surface.surfaceId].filter(Boolean).join(" · ");
	const missing = surface.missingCapabilities?.length
		? ` (${surface.missingCapabilities.join(", ")})`
		: "";
	item.textContent = `${name || "unknown surface"}: ${surface.reason}${missing}`;
	return item;
}

function renderSurfaceListItem(
	surface: MountedHomesteadSurface,
): HTMLLIElement {
	const item = document.createElement("li");
	item.className = "refarm-card-body";
	item.dataset.refarmSurfaceMountKey = mountedHomesteadSurfaceKey(surface);

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
