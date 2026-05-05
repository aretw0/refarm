import {
	connectHomesteadReactiveElement,
	defineHomesteadReactiveElement,
	type HomesteadReactiveElement,
} from "@refarm.dev/homestead/sdk/custom-element";
import {
	isHomesteadSurfaceActionEvent,
	isHomesteadSurfaceChangeEvent,
	listHomesteadSurfaceActions,
	listMountedHomesteadSurfaces,
	listRejectedHomesteadSurfaces,
	mountedHomesteadSurfaceKey,
	type HomesteadSurfaceActionDiagnostic,
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

export interface StudioSurfaceLedgerMountOptions {
	root?: ParentNode;
	telemetry?: HomesteadSurfaceTelemetrySource;
	telemetryEvents?: readonly HomesteadSurfaceTelemetryEvent[];
}

export const STUDIO_SURFACE_LEDGER_ELEMENT_NAME = "refarm-surface-ledger";

export interface StudioSurfaceLedgerElement
	extends HomesteadReactiveElement<
		StudioSurfaceLedgerMountOptions | undefined,
		StudioSurfaceLedgerController
	> {}

export function mountStudioSurfaceLedger(
	container: HTMLElement,
	root: ParentNode = document,
	options: { telemetryEvents?: readonly HomesteadSurfaceTelemetryEvent[] } = {},
): HTMLElement {
	container
		.querySelector<HTMLElement>("[data-refarm-studio-surface-ledger]")
		?.remove();

	const mountedSurfaces = listMountedHomesteadSurfaces(root);
	const telemetryEvents = options.telemetryEvents ?? [];
	const rejectedSurfaces = listRejectedHomesteadSurfaces(telemetryEvents);
	const surfaceActions = listHomesteadSurfaceActions(telemetryEvents);
	const ledger = document.createElement("section");
	ledger.dataset.refarmStudioSurfaceLedger = "true";
	ledger.className = "refarm-stack";
	ledger.setAttribute("aria-label", "Surface activation ledger");

	const summary = document.createElement("div");
	summary.className = "refarm-cluster";
	summary.appendChild(renderMetric("mounted", mountedSurfaces.length));
	summary.appendChild(renderMetric("rejected", rejectedSurfaces.length));
	summary.appendChild(renderMetric("actions", surfaceActions.length));
	ledger.appendChild(summary);

	const table = document.createElement("table");
	table.className = "refarm-data-table surface-ledger-table";
	table.appendChild(renderHeader());
	const body = document.createElement("tbody");

	for (const surface of mountedSurfaces) {
		body.appendChild(renderMountedRow(surface));
	}
	for (const surface of rejectedSurfaces) {
		body.appendChild(renderRejectedRow(surface));
	}
	for (const action of surfaceActions) {
		body.appendChild(renderActionRow(action));
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
	options: StudioSurfaceLedgerMountOptions = {},
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
		if (
			event.event === "ui:surface_rejected" ||
			isHomesteadSurfaceActionEvent(event)
		) {
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

export function defineStudioSurfaceLedgerElement(
	registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
	defineHomesteadReactiveElement<
		StudioSurfaceLedgerMountOptions | undefined,
		StudioSurfaceLedgerController
	>({
		name: STUDIO_SURFACE_LEDGER_ELEMENT_NAME,
		registry,
		connect: (element, options) =>
			mountReactiveStudioSurfaceLedger(element, options ?? {}),
	});
}

export function mountReactiveStudioSurfaceLedgerElement(
	element: StudioSurfaceLedgerElement,
	options: StudioSurfaceLedgerMountOptions = {},
): StudioSurfaceLedgerController {
	defineStudioSurfaceLedgerElement();
	return connectHomesteadReactiveElement(element, options);
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
	const renderMode = surface.surfaceRenderMode
		? ` render: ${surface.surfaceRenderMode}`
		: "";
	return `${state}${capabilities}${renderMode}`;
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

function renderActionRow(
	action: HomesteadSurfaceActionDiagnostic,
): HTMLTableRowElement {
	const row = document.createElement("tr");
	row.dataset.refarmSurfaceLedgerState = `action-${action.status}`;
	const detail = [
		`action: ${action.actionId}`,
		action.actionIntent ? `intent: ${action.actionIntent}` : undefined,
		action.errorMessage ? `error: ${action.errorMessage}` : undefined,
	]
		.filter(Boolean)
		.join(" ");
	appendCells(row, [
		action.status === "failed" ? "action failed" : "action requested",
		action.pluginId ?? "unknown",
		action.surfaceId ?? action.mountSource ?? "unknown",
		action.slotId ?? "unknown",
		action.surfaceKind ?? "unknown",
		detail,
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
