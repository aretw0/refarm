import { describe, expect, it, vi } from "vitest";
import type { bootStudioRuntime } from "@refarm.dev/homestead/sdk/runtime";
import type { setupStudioShell } from "@refarm.dev/homestead/sdk/shell";
import type { createRefarmMeSurfacePlugins } from "./me-surfaces";
import {
	REFARM_ME_OPEN_VAULT_ACTION_ID,
	REFARM_ME_PERSONAL_SURFACE_ID,
	REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
} from "./me-surfaces";
import {
	bootRefarmMeWorkbench,
	REFARM_ME_LOADING_ID,
	REFARM_ME_RENDERER,
	renderRefarmMeBootFailure,
} from "./me-runtime";

describe("refarm.me runtime", () => {
	it("boots the personal workbench behind the Astro page boundary", async () => {
		const doc = createMeDocument();
		const tractor = createTractorFixture();
		const bootRuntime = vi.fn(async () => ({
			tractor,
		})) as unknown as typeof bootStudioRuntime;
		const setupShellMock = vi.fn(
			async (_tractor: unknown, _options: unknown) => ({}),
		);
		const setupShell = setupShellMock as unknown as typeof setupStudioShell;
		const pluginConstructors = createPluginConstructors();
		const createSurfacePlugins = vi.fn((emit) => {
			emit(REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID, "surface:created", {
				ok: true,
			});
			return [createPluginFixture(REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID)];
		}) as unknown as typeof createRefarmMeSurfacePlugins;

		const workbench = await bootRefarmMeWorkbench({
			document: doc,
			bootRuntime,
			setupShell,
			pluginConstructors,
			createSurfacePlugins,
			log: { error: vi.fn() },
		});

		expect(bootRuntime).toHaveBeenCalledWith({
			databaseName: "refarm-me-main",
			namespace: "citizen",
			identityId: "citizen",
			identityPublicKey: "me",
			envMetadata: { version: "0.1.0-solo-fertil", commit: "me" },
			connectBrowserSync: true,
			tractorSync: true,
		});
		expect(tractor.emitTelemetry).toHaveBeenCalledWith({
			event: "surface:created",
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			payload: { ok: true },
		});
		expect(tractor.plugins.registerInternal).toHaveBeenCalledWith(
			expect.objectContaining({ id: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID }),
		);
		expect(setupShell).toHaveBeenCalledWith(
			tractor,
			expect.objectContaining({
				surfaceContext: expect.any(Function),
				surfaceAction: expect.any(Function),
			}),
		);
		expect(pluginConstructors.herald.announce).toHaveBeenCalled();
		expect(doc.getElementById(REFARM_ME_LOADING_ID)).toBeNull();
		expect(workbench).toEqual({
			tractor,
			renderer: REFARM_ME_RENDERER,
			surfacePluginIds: [REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID],
		});

		const shellOptions = setupShellMock.mock.calls[0]?.[1] as unknown as {
			surfaceContext: (...args: unknown[]) => unknown;
			surfaceAction: (...args: unknown[]) => unknown;
		};
		const surface = {
			layer: "homestead" as const,
			kind: "panel" as const,
			id: REFARM_ME_PERSONAL_SURFACE_ID,
			slot: "main",
		};
		const request = {
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			slotId: "main",
			mountSource: "extension-surface" as const,
			surface,
			locale: "en",
		};
		const host = await shellOptions.surfaceContext(request);
		expect(host).toMatchObject({ hostId: "apps/me" });

		await expect(
			shellOptions.surfaceAction({
				...request,
				host,
				action: (host as { actions: unknown[] }).actions[0]!,
			}),
		).resolves.toBe(true);
		expect(tractor.emitTelemetry).toHaveBeenCalledWith({
			event: "me:surface_action",
			pluginId: REFARM_ME_PERSONAL_SURFACE_PLUGIN_ID,
			payload: {
				actionId: REFARM_ME_OPEN_VAULT_ACTION_ID,
				actionIntent: "me:vault-open",
				surfaceId: REFARM_ME_PERSONAL_SURFACE_ID,
			},
		});
	});

	it("renders boot failure copy in the loading boundary", () => {
		const doc = createMeDocument();
		const log = { error: vi.fn() };

		renderRefarmMeBootFailure(new Error("OPFS denied"), {
			document: doc,
			log,
		});

		expect(log.error).toHaveBeenCalledWith(
			"[me] Boot failed",
			expect.any(Error),
		);
		expect(doc.getElementById(REFARM_ME_LOADING_ID)?.textContent).toBe(
			"Personal space boot failed: OPFS denied",
		);
	});
});

function createMeDocument(): Document {
	const document = createDocumentFixture();
	const loading = document.createElement("div");
	loading.id = REFARM_ME_LOADING_ID;
	document.body.replaceChildren(loading);
	return document as unknown as Document;
}

function createDocumentFixture() {
	const elementsById = new Map<string, ElementFixture>();
	const document = {
		body: undefined as unknown as ElementFixture,
		createElement: (tagName: string) => createElementFixture(tagName),
		getElementById: (id: string) => {
			const element = elementsById.get(id);
			return element && element.parent ? element : null;
		},
		registerElement: (element: ReturnType<typeof createElementFixture>) => {
			if (element.id) elementsById.set(element.id, element);
			for (const child of element.children) document.registerElement(child);
		},
	};
	document.body = createElementFixture("body", document.registerElement);
	return document;
}

interface ElementFixture {
	tagName: string;
	className: string;
	style: Record<string, string>;
	parent: ElementFixture | null;
	children: ElementFixture[];
	appendChild(child: ElementFixture): ElementFixture;
	replaceChildren(...nextChildren: ElementFixture[]): void;
	remove(): void;
	textContent: string;
	id: string;
}

function createElementFixture(
	tagName: string,
	onChildrenChanged?: (element: ElementFixture) => void,
): ElementFixture {
	let elementId = "";
	let ownText = "";
	const children: ElementFixture[] = [];
	const element: ElementFixture = {
		tagName: tagName.toUpperCase(),
		className: "",
		style: {} as Record<string, string>,
		parent: null,
		children,
		appendChild: (child: ElementFixture) => {
			child.parent = element;
			children.push(child);
			onChildrenChanged?.(element);
			return child;
		},
		replaceChildren: (...nextChildren: ElementFixture[]) => {
			children.splice(0, children.length);
			for (const child of nextChildren) {
				child.parent = element;
				children.push(child);
			}
			onChildrenChanged?.(element);
		},
		remove: () => {
			if (!element.parent) return;
			const siblings = element.parent.children;
			const index = siblings.indexOf(element);
			if (index >= 0) siblings.splice(index, 1);
			element.parent = null;
		},
		get textContent() {
			return ownText + children.map((child) => child.textContent).join("");
		},
		set textContent(value: string) {
			ownText = value;
		},
		get id() {
			return elementId;
		},
		set id(value: string) {
			elementId = value;
		},
	};
	return element;
}

function createTractorFixture() {
	return {
		plugins: { registerInternal: vi.fn() },
		emitTelemetry: vi.fn(),
	};
}

function createPluginConstructors() {
	const herald = { announce: vi.fn() };
	class HeraldPlugin {
		announce = herald.announce;
	}
	class FireflyPlugin {}
	return { HeraldPlugin, FireflyPlugin, herald };
}

function createPluginFixture(id: string) {
	return {
		id,
		manifest: {
			id,
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: REFARM_ME_PERSONAL_SURFACE_ID,
						slot: "main",
					},
				],
			},
		},
	};
}
