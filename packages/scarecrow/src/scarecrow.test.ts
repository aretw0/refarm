import type { ScarecrowHost } from "./index";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScarecrowPlugin } from "./index";

describe("ScarecrowPlugin", () => {
  let host: {
    emitTelemetry: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
    queryNodes: ReturnType<typeof vi.fn>;
    setPluginState: ReturnType<typeof vi.fn>;
  };
  let scarecrow: ScarecrowPlugin;

  beforeEach(() => {
    host = {
      emitTelemetry: vi.fn(),
      observe: vi.fn(),
      queryNodes: vi.fn().mockResolvedValue([]),
      setPluginState: vi.fn(),
    };
    scarecrow = new ScarecrowPlugin(host as ScarecrowHost);
  });

  it("should monitor update velocity and transition state if too high", () => {
    // Simulate telemetry callback
    const callback = host.observe.mock.calls[0]![0];

    callback({
      event: "ui:performance",
      pluginId: "busy-plugin",
      payload: { updateVelocity: 100, slotId: "sidebar" },
    });

    expect(host.setPluginState).toHaveBeenCalledWith(
      "busy-plugin",
      "throttled",
    );
    expect(scarecrow.getSystemHealth()).toBeLessThan(1.0);
  });

  it("should monitor a11yScore and alert if too low", () => {
    const callback = host.observe.mock.calls[0]![0];

    callback({
      event: "ui:a11y_audit",
      pluginId: "sloppy-plugin",
      payload: { a11yScore: 0.5 },
    });

    expect(host.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "system:alert",
        payload: {
          reason: expect.stringContaining("Low Accessibility Score"),
          severity: "warn",
        },
      }),
    );
  });
});
