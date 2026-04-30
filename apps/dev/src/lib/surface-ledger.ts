import {
	isHomesteadSurfaceChangeEvent,
	listMountedHomesteadSurfaces,
	listRejectedHomesteadSurfaces,
	mountedHomesteadSurfaceKey,
	type HomesteadSurfaceTelemetryEvent,
	type HomesteadSurfaceTelemetrySource,
	type MountedHomesteadSurface,
	type RejectedHomesteadSurfaceActivation,
} from "@refarm.dev/homestead/sdk/surface-inspector";

export interface StudioSurfaceLedgerController {
	readonly element: HTMLElement;
	refresh(): HTMLElement;
	dispose(): void;
}

export function mountStudioSurfaceLedger(
	container: HTMLElement,
	root: ParentNode = document,
	options: { telemetryEvents?: readonly HomesteadSurfaceTelemetryEvent[] } = {},
): HTMLElement {
	container
		.querySelector<HTMLElement>("[data-refarm-studio-surface-ledger]")
		?.remove();

	const mountedSurfaces = listMountedHomesteadSurfaces(root);
	const rejectedSurfaces = listRejectedHomesteadSurfaces(
		options.telemetryEvents ?? [],
	);
	const ledger = document.createElement("section");
	ledger.dataset.refarmStudioSurfaceLedger = "true";
	ledger.className = "refarm-stack";
	ledger.setAttribute("aria-label", "Surface activation ledger");

	const summary = document.createElement("div");
	summary.className = "refarm-cluster";
	summary.appendChild(renderMetric("mounted", mountedSurfaces.length));
	summary.appendChild(renderMetric("rejected", rejectedSurfaces.length));
	ledger.appendChild(summary);

	const table = document.createElement("table");
	table.className = "surface-ledger-table";
	table.appendChild(renderHeader());
	const body = document.createElement("tbody");

	for (const surface of mountedSurfaces) {
		body.appendChild(renderMountedRow(surface));
	}
	for (const surface of rejectedSurfaces) {
		body.appendChild(renderRejectedRow(surface));
	}

	if (body.children.length === 0) {
		body.appendChild(renderEmptyRow());
	}
	table.appendChild(body);
	ledger.appendChild(table);
	container.appendChild(ledger);
	return ledger;
}

export function mountReactiveStudioSurfaceLedger(
	container: HTMLElement,
	options: {
		root?: ParentNode;
		telemetry?: HomesteadSurfaceTelemetrySource;
		telemetryEvents?: readonly HomesteadSurfaceTelemetryEvent[];
	} = {},
): StudioSurfaceLedgerController {
	const root = options.root ?? document;
	const telemetryEvents = [...(options.telemetryEvents ?? [])];
	let currentElement = mountStudioSurfaceLedger(container, root, {
		telemetryEvents,
	});

	const refresh = () => {
		currentElement = mountStudioSurfaceLedger(container, root, {
			telemetryEvents,
		});
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

function renderMetric(label: string, value: number): HTMLElement {
	const metric = document.createElement("span");
	metric.className = "refarm-badge";
	metric.dataset.refarmSurfaceLedgerMetric = label;
	metric.textContent = `${value} ${label}`;
	return metric;
}

function renderHeader(): HTMLTableSectionElement {
	const head = document.createElement("thead");
	const row = document.createElement("tr");
	for (const label of [
		"status",
		"plugin",
		"surface",
		"slot",
		"kind",
		"gate detail",
	]) {
		const cell = document.createElement("th");
		cell.scope = "col";
		cell.textContent = label;
		row.appendChild(cell);
	}
	head.appendChild(row);
	return head;
}

function renderMountedRow(
	surface: MountedHomesteadSurface,
): HTMLTableRowElement {
	const row = document.createElement("tr");
	row.dataset.refarmSurfaceLedgerState = "mounted";
	row.dataset.refarmSurfaceMountKey = mountedHomesteadSurfaceKey(surface);
	appendCells(row, [
		"mounted",
		surface.pluginId,
		surface.surfaceId ?? surface.mountSource,
		surface.slotId,
		surface.surfaceKind ?? "legacy",
		mountedSurfaceGateDetail(surface),
	]);
	return row;
}

function mountedSurfaceGateDetail(surface: MountedHomesteadSurface): string {
	const state = surface.state ? `state: ${surface.state}` : "accepted";
	const capabilities = surface.surfaceCapabilities?.length
		? ` caps: ${surface.surfaceCapabilities.join(", ")}`
		: "";
	return `${state}${capabilities}`;
}

function renderRejectedRow(
	surface: RejectedHomesteadSurfaceActivation,
): HTMLTableRowElement {
	const row = document.createElement("tr");
	row.dataset.refarmSurfaceLedgerState = "rejected";
	const missing = surface.missingCapabilities?.length
		? ` missing: ${surface.missingCapabilities.join(", ")}`
		: "";
	const trust = surface.registryStatus
		? ` ${surface.trustSource ?? "trust"}: ${surface.registryStatus}`
		: "";
	appendCells(row, [
		surface.reason,
		surface.pluginId ?? "unknown",
		surface.surfaceId ?? "unknown",
		surface.slotId ?? "unknown",
		surface.surfaceKind ?? "unknown",
		`${surface.reason}${missing}${trust}`,
	]);
	return row;
}

function renderEmptyRow(): HTMLTableRowElement {
	const row = document.createElement("tr");
	const cell = document.createElement("td");
	cell.colSpan = 6;
	cell.className = "refarm-card-body";
	cell.textContent = "No surface activation telemetry is available yet.";
	row.appendChild(cell);
	return row;
}

function appendCells(row: HTMLTableRowElement, values: string[]): void {
	for (const value of values) {
		const cell = document.createElement("td");
		cell.textContent = value;
		row.appendChild(cell);
	}
}
