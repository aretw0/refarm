import { beforeEach, describe, expect, it } from "vitest";
import { createTractorMock } from "../../tractor/test/test-utils";
import { ScarecrowPlugin } from "./index";

describe("ScarecrowPlugin", () => {
  let tractor: any;
  let scarecrow: ScarecrowPlugin;

  beforeEach(() => {
    tractor = createTractorMock();
    scarecrow = new ScarecrowPlugin(tractor as any);
  });

  it("should monitor update velocity and transition state if too high", () => {
    // Simulate telemetry callback
    const callback = tractor.observe.mock.calls[0][0];
    
    callback({
      event: "ui:performance",
      pluginId: "gremlin-plugin",
      payload: { updateVelocity: 100, slotId: "sidebar" }
    });

    expect(tractor.setPluginState).toHaveBeenCalledWith("gremlin-plugin", "throttled");
    expect(scarecrow.getSystemHealth()).toBeLessThan(1.0);
  });

  it("should monitor a11yScore and alert if too low", () => {
    const callback = tractor.observe.mock.calls[0][0];
    
    callback({
      event: "ui:a11y_audit",
      pluginId: "sloppy-plugin",
      payload: { a11yScore: 0.5 }
    });

    expect(tractor.emitTelemetry).toHaveBeenCalledWith(expect.objectContaining({
        event: "system:alert",
        payload: { reason: expect.stringContaining("Low Accessibility Score"), severity: "warn" }
    }));
  });
});
