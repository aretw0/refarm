/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioShell } from "../src/sdk/Shell";

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

    it("should inject a plugin into its preferred slot", async () => {
        const shell = new StudioShell(tractorMock as any);
        await shell.setup();

        const statusbar = document.getElementById("refarm-slot-statusbar");
        expect(statusbar?.innerHTML).toContain("plugin-view");
        expect(statusbar?.innerHTML).toContain("test-plugin");
    });

    it("should inject homestead extension surfaces into declared slots", async () => {
        tractorMock.plugins.getAllPlugins.mockReturnValue([
            {
                id: "surface-plugin",
                manifest: {
                    capabilities: { provides: [], requires: [] },
                    extensions: {
                        surfaces: [
                            {
                                layer: "homestead",
                                kind: "panel",
                                id: "stream-panel",
                                slot: "main",
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
