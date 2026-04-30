/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupStudioShell, StudioShell } from "../src/sdk/Shell";

describe("StudioShell Orchestrator", () => {
    let tractorMock: any;
    let nodeHandlers: Record<string, (node: any) => Promise<void>>;

    beforeEach(() => {
        // Setup JSDOM environment
        document.body.innerHTML = `
            <div id="refarm-slot-header" class="slot"></div>
            <div id="refarm-slot-main" class="slot"></div>
            <div id="refarm-slot-streams" class="slot" hidden></div>
            <div id="refarm-slot-statusbar" class="slot"></div>
            <div id="system-status"></div>
        `;

        nodeHandlers = {};

        tractorMock = {
            plugins: {
                getAllPlugins: vi.fn().mockReturnValue([
                    {
                        id: "test-plugin",
                        manifest: {
                            ui: { slots: ["statusbar"] }
                        }
                    }
                ]),
                get: vi.fn().mockReturnValue({ state: "running" })
            },
            getPluginApi: vi.fn().mockResolvedValue("mock-api"),
            observe: vi.fn(),
            onNode: vi.fn((type: string, handler: (node: any) => Promise<void>) => {
                nodeHandlers[type] = handler;
                return vi.fn();
            }),
            emitTelemetry: vi.fn(),
            getHelpNodes: vi.fn().mockResolvedValue([{ "refarm:renderType": "landing", name: "Test Landing Node", text: "Welcome" }])
        };
    });

    it("should discover all available slots in the DOM", () => {
        const shell = new StudioShell(tractorMock as any);
        // Accessing private map for verification (via cast)
        const slots = (shell as any).slots;
        expect(slots.has("header")).toBe(true);
        expect(slots.has("main")).toBe(true);
        expect(slots.has("statusbar")).toBe(true);
    });

    it("should set up and return the shell through the shared helper", async () => {
        const shell = await setupStudioShell(tractorMock as any);

        expect(shell).toBeInstanceOf(StudioShell);
        expect(tractorMock.observe).toHaveBeenCalledTimes(1);
        expect(tractorMock.onNode).toHaveBeenCalledWith("StreamSession", expect.any(Function));
        expect(tractorMock.onNode).toHaveBeenCalledWith("StreamChunk", expect.any(Function));
        expect(document.getElementById("system-status")?.textContent).toBe("Ready");
    });

    it("should inject a plugin into its preferred slot", async () => {
        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        const statusbar = document.getElementById("refarm-slot-statusbar");
        expect(statusbar?.innerHTML).toContain("plugin-view");
        expect(statusbar?.innerHTML).toContain("test-plugin");
        expect(
            statusbar?.querySelector("[data-refarm-plugin-id='test-plugin']")?.getAttribute("data-refarm-mount-source"),
        ).toBe("legacy-ui-slot");
    });

    it("should inject homestead extension surfaces into declared slots", async () => {
        tractorMock.plugins.getAllPlugins.mockReturnValue([
            {
                id: "surface-plugin",
                manifest: {
                    entry: "internal:surface-plugin",
                    capabilities: { provides: [], requires: [] },
                    extensions: {
                        surfaces: [
                            {
                                layer: "homestead",
                                kind: "panel",
                                id: "stream-panel",
                                slot: "main",
                                capabilities: ["ui:panel:render"],
                            },
                            {
                                layer: "automation",
                                kind: "workflow-step",
                                id: "ignored",
                                slot: "statusbar",
                            },
                        ],
                    },
                },
            },
        ]);

        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        const main = document.getElementById("refarm-slot-main");
        const statusbar = document.getElementById("refarm-slot-statusbar");
        expect(main?.innerHTML).toContain("surface-plugin");
        expect(statusbar?.innerHTML).not.toContain("surface-plugin");
        const surfaceMount = main?.querySelector("[data-refarm-surface-id='stream-panel']");
        expect(surfaceMount?.getAttribute("data-refarm-mount-source")).toBe("extension-surface");
        expect(surfaceMount?.getAttribute("data-refarm-surface-kind")).toBe("panel");
        expect(surfaceMount?.getAttribute("data-refarm-surface-capabilities")).toBe("ui:panel:render");
        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_mounted",
            pluginId: "surface-plugin",
            payload: {
                slotId: "main",
                mountSource: "extension-surface",
                surfaceId: "stream-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                surfaceCapabilities: ["ui:panel:render"],
            },
        });
    });

    it("should render plugin-provided homestead surface content", async () => {
        const renderHomesteadSurface = vi.fn().mockResolvedValue({
            html: '<section data-rendered-surface="stream">Plugin stream panel</section>',
        });
        const plugin = {
            id: "rendering-surface-plugin",
            state: "running",
            call: renderHomesteadSurface,
            manifest: {
                entry: "internal:rendering-surface-plugin",
                capabilities: { provides: [], requires: [] },
                extensions: {
                    surfaces: [
                        {
                            layer: "homestead",
                            kind: "panel",
                            id: "rendered-stream-panel",
                            slot: "main",
                            capabilities: ["ui:panel:render", "ui:stream:read"],
                        },
                    ],
                },
            },
        };
        tractorMock.plugins.getAllPlugins.mockReturnValue([plugin]);
        tractorMock.plugins.get.mockReturnValue(plugin);

        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        const main = document.getElementById("refarm-slot-main");
        const surfaceMount = main?.querySelector<HTMLElement>("[data-refarm-surface-id='rendered-stream-panel']");
        expect(surfaceMount?.dataset.refarmSurfaceRenderMode).toBe("html");
        expect(surfaceMount?.querySelector("[data-rendered-surface='stream']")?.textContent).toBe(
            "Plugin stream panel",
        );
        expect(renderHomesteadSurface).toHaveBeenCalledWith("renderHomesteadSurface", {
            pluginId: "rendering-surface-plugin",
            slotId: "main",
            mountSource: "extension-surface",
            surface: expect.objectContaining({
                id: "rendered-stream-panel",
                kind: "panel",
                layer: "homestead",
                slot: "main",
                capabilities: ["ui:panel:render", "ui:stream:read"],
            }),
            locale: "en",
        });
        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_rendered",
            pluginId: "rendering-surface-plugin",
            payload: {
                slotId: "main",
                mountSource: "extension-surface",
                surfaceId: "rendered-stream-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                surfaceRenderMode: "html",
            },
        });
    });

    it("should pass host-owned surface context into plugin render hooks", async () => {
        const renderHomesteadSurface = vi.fn().mockResolvedValue("Context aware");
        const surfaceContext = vi.fn().mockResolvedValue({
            hostId: "apps/dev",
            data: { streamCount: 2 },
            actions: [
                {
                    id: "open-streams",
                    label: "Open streams",
                    intent: "studio:navigate",
                    payload: { href: "/streams" },
                },
            ],
        });
        const plugin = {
            id: "contextual-surface-plugin",
            state: "running",
            call: renderHomesteadSurface,
            manifest: {
                entry: "internal:contextual-surface-plugin",
                capabilities: { provides: [], requires: [] },
                extensions: {
                    surfaces: [
                        {
                            layer: "homestead",
                            kind: "panel",
                            id: "contextual-panel",
                            slot: "main",
                            capabilities: ["ui:panel:render", "ui:stream:read"],
                        },
                    ],
                },
            },
        };
        tractorMock.plugins.getAllPlugins.mockReturnValue([plugin]);
        tractorMock.plugins.get.mockReturnValue(plugin);

        const shell = new StudioShell(tractorMock as any, { surfaceContext });
        await shell.setup();

        expect(surfaceContext).toHaveBeenCalledWith({
            pluginId: "contextual-surface-plugin",
            slotId: "main",
            mountSource: "extension-surface",
            surface: expect.objectContaining({ id: "contextual-panel" }),
            locale: "en",
        });
        expect(renderHomesteadSurface).toHaveBeenCalledWith("renderHomesteadSurface", {
            pluginId: "contextual-surface-plugin",
            slotId: "main",
            mountSource: "extension-surface",
            surface: expect.objectContaining({ id: "contextual-panel" }),
            locale: "en",
            host: {
                hostId: "apps/dev",
                data: { streamCount: 2 },
                actions: [
                    {
                        id: "open-streams",
                        label: "Open streams",
                        intent: "studio:navigate",
                        payload: { href: "/streams" },
                    },
                ],
            },
        });
    });

    it("should dispatch host-owned surface actions from rendered markup", async () => {
        const renderHomesteadSurface = vi.fn().mockResolvedValue({
            html: '<button type="button" data-refarm-surface-action-id="open-streams">Open streams</button>',
        });
        const surfaceContext = vi.fn().mockResolvedValue({
            hostId: "apps/dev",
            actions: [
                {
                    id: "open-streams",
                    label: "Open streams",
                    intent: "studio:navigate",
                    payload: { href: "/streams" },
                },
            ],
        });
        const surfaceAction = vi.fn().mockResolvedValue(undefined);
        const plugin = {
            id: "action-surface-plugin",
            state: "running",
            call: renderHomesteadSurface,
            manifest: {
                entry: "internal:action-surface-plugin",
                capabilities: { provides: [], requires: [] },
                extensions: {
                    surfaces: [
                        {
                            layer: "homestead",
                            kind: "panel",
                            id: "action-panel",
                            slot: "main",
                            capabilities: ["ui:panel:render"],
                        },
                    ],
                },
            },
        };
        tractorMock.plugins.getAllPlugins.mockReturnValue([plugin]);
        tractorMock.plugins.get.mockReturnValue(plugin);

        const shell = new StudioShell(tractorMock as any, {
            surfaceContext,
            surfaceAction,
        });
        await shell.setup();

        document
            .querySelector<HTMLButtonElement>("[data-refarm-surface-action-id='open-streams']")
            ?.click();
        await Promise.resolve();

        expect(surfaceAction).toHaveBeenCalledWith({
            pluginId: "action-surface-plugin",
            slotId: "main",
            mountSource: "extension-surface",
            surface: expect.objectContaining({ id: "action-panel" }),
            locale: "en",
            host: {
                hostId: "apps/dev",
                actions: [
                    {
                        id: "open-streams",
                        label: "Open streams",
                        intent: "studio:navigate",
                        payload: { href: "/streams" },
                    },
                ],
            },
            action: {
                id: "open-streams",
                label: "Open streams",
                intent: "studio:navigate",
                payload: { href: "/streams" },
            },
        });
        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_action_requested",
            pluginId: "action-surface-plugin",
            payload: {
                slotId: "main",
                mountSource: "extension-surface",
                surfaceId: "action-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                actionId: "open-streams",
                actionIntent: "studio:navigate",
            },
        });
    });

    it("should emit telemetry when homestead surface rendering fails", async () => {
        const renderHomesteadSurface = vi.fn().mockRejectedValue(new Error("render boom"));
        const plugin = {
            id: "failing-surface-plugin",
            state: "running",
            call: renderHomesteadSurface,
            manifest: {
                entry: "internal:failing-surface-plugin",
                extensions: {
                    surfaces: [
                        {
                            layer: "homestead",
                            kind: "panel",
                            id: "failing-panel",
                            slot: "main",
                            capabilities: ["ui:panel:render"],
                        },
                    ],
                },
            },
        };
        tractorMock.plugins.getAllPlugins.mockReturnValue([plugin]);
        tractorMock.plugins.get.mockReturnValue(plugin);

        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        const main = document.getElementById("refarm-slot-main");
        const surfaceMount = main?.querySelector<HTMLElement>("[data-refarm-surface-id='failing-panel']");
        expect(surfaceMount?.dataset.refarmSurfaceRenderMode).toBe("failed");
        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_render_failed",
            pluginId: "failing-surface-plugin",
            payload: {
                slotId: "main",
                mountSource: "extension-surface",
                surfaceId: "failing-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                surfaceRenderMode: "failed",
                errorMessage: "render boom",
            },
        });
    });

    it("should emit telemetry for rejected homestead extension surfaces", async () => {
        tractorMock.plugins.getAllPlugins.mockReturnValue([
            {
                id: "rejected-surface-plugin",
                manifest: {
                    extensions: {
                        surfaces: [
                            {
                                layer: "homestead",
                                kind: "panel",
                                id: "secrets-panel",
                                slot: "main",
                                capabilities: ["ui:panel:render", "ui:secrets:read"],
                            },
                            {
                                layer: "homestead",
                                kind: "panel",
                                id: "missing-slot-panel",
                            },
                            {
                                layer: "homestead",
                                kind: "panel",
                                id: "ghost-panel",
                                slot: "ghost",
                            },
                            {
                                layer: "homestead",
                                kind: "panel",
                                id: "untrusted-panel",
                                slot: "main",
                                capabilities: ["ui:panel:render"],
                            },
                        ],
                    },
                },
            },
        ]);

        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_rejected",
            pluginId: "rejected-surface-plugin",
            payload: {
                reason: "unsupported-capability",
                surfaceId: "secrets-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                slotId: "main",
                missingCapabilities: ["ui:secrets:read"],
            },
        });
        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_rejected",
            pluginId: "rejected-surface-plugin",
            payload: {
                reason: "missing-slot",
                surfaceId: "missing-slot-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                slotId: undefined,
                missingCapabilities: undefined,
            },
        });
        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_rejected",
            pluginId: "rejected-surface-plugin",
            payload: {
                reason: "unknown-slot",
                surfaceId: "ghost-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                slotId: "ghost",
                missingCapabilities: undefined,
            },
        });
        expect(tractorMock.emitTelemetry).toHaveBeenCalledWith({
            event: "ui:surface_rejected",
            pluginId: "rejected-surface-plugin",
            payload: {
                reason: "untrusted-plugin",
                surfaceId: "untrusted-panel",
                surfaceKind: "panel",
                surfaceLayer: "homestead",
                slotId: "main",
                missingCapabilities: undefined,
                trustSource: "registry",
                registryStatus: "unregistered",
            },
        });
    });

    it("should preserve executable stream-slot surfaces while rendering live streams", async () => {
        const renderHomesteadSurface = vi.fn().mockResolvedValue({
            html: '<section data-rendered-stream-surface="true">Plugin stream cockpit</section>',
        });
        const plugin = {
            id: "stream-surface-plugin",
            state: "running",
            call: renderHomesteadSurface,
            manifest: {
                entry: "internal:stream-surface-plugin",
                extensions: {
                    surfaces: [
                        {
                            layer: "homestead",
                            kind: "panel",
                            id: "plugin-stream-panel",
                            slot: "streams",
                            capabilities: ["ui:panel:render", "ui:stream:read"],
                        },
                    ],
                },
            },
        };
        tractorMock.plugins.getAllPlugins.mockReturnValue([plugin]);
        tractorMock.plugins.get.mockReturnValue(plugin);

        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        const streams = document.getElementById("refarm-slot-streams");
        expect(streams?.hidden).toBe(false);
        const surfaceMount = streams?.querySelector<HTMLElement>("[data-refarm-surface-id='plugin-stream-panel']");
        expect(surfaceMount?.dataset.refarmSurfaceRenderMode).toBe("html");
        expect(surfaceMount?.querySelector("[data-rendered-stream-surface='true']")?.textContent).toBe(
            "Plugin stream cockpit",
        );

        await nodeHandlers.StreamSession({
            "@type": "StreamSession",
            "@id": "urn:tractor:stream:agent-response:prompt-b",
            stream_ref: "urn:tractor:stream:agent-response:prompt-b",
            stream_kind: "agent-response",
            status: "active",
            metadata: { prompt_ref: "prompt-b" },
        });

        expect(streams?.querySelector("[data-refarm-surface-id='plugin-stream-panel']")).toBeTruthy();
        expect(streams?.querySelector("[data-rendered-stream-surface='true']")?.textContent).toBe(
            "Plugin stream cockpit",
        );
        expect(streams?.querySelector("[data-refarm-stream-panel]")?.textContent).toContain("prompt-b");
    });

    it("should update system status during orchestration", async () => {
        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        const statusEl = document.getElementById("system-status");
        // Default mock locale is 'en' unless navigator.language is mocked
        expect(statusEl?.textContent).toBe("Ready");
    });

    it("should render live stream observations from typed node subscribers", async () => {
        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        await nodeHandlers.StreamSession({
            "@type": "StreamSession",
            "@id": "urn:tractor:stream:agent-response:prompt-a",
            stream_ref: "urn:tractor:stream:agent-response:prompt-a",
            stream_kind: "agent-response",
            status: "active",
            metadata: {
                prompt_ref: "prompt-a",
                provider_family: "anthropic",
                model: "claude-test",
            },
        });
        await nodeHandlers.StreamChunk({
            "@type": "StreamChunk",
            "@id": "urn:tractor:stream-chunk:1",
            stream_ref: "urn:tractor:stream:agent-response:prompt-a",
            sequence: 1,
            payload_kind: "text_delta",
            content: "hello from the stream",
        });

        const statusbar = document.getElementById("refarm-slot-statusbar");
        const streams = document.getElementById("refarm-slot-streams");
        expect(statusbar?.textContent).toContain("prompt-a");
        expect(statusbar?.textContent).toContain("active");
        expect(statusbar?.textContent).toContain("hello from the stream");
        expect(streams?.hidden).toBe(false);
        expect(streams?.textContent).toContain("Live soil telemetry");
        expect(streams?.textContent).toContain("hello from the stream");
    });
});
