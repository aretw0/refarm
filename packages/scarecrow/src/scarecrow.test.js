"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var test_utils_1 = require("../../tractor/test/test-utils");
var index_1 = require("./index");
(0, vitest_1.describe)("ScarecrowPlugin", function () {
    var tractor;
    var scarecrow;
    (0, vitest_1.beforeEach)(function () {
        tractor = (0, test_utils_1.createTractorMock)();
        scarecrow = new index_1.ScarecrowPlugin(tractor);
    });
    (0, vitest_1.it)("should monitor update velocity and transition state if too high", function () {
        // Simulate telemetry callback
        var callback = tractor.observe.mock.calls[0][0];
        callback({
            event: "ui:performance",
            pluginId: "gremlin-plugin",
            payload: { updateVelocity: 100, slotId: "sidebar" }
        });
        (0, vitest_1.expect)(tractor.setPluginState).toHaveBeenCalledWith("gremlin-plugin", "throttled");
        (0, vitest_1.expect)(scarecrow.getSystemHealth()).toBeLessThan(1.0);
    });
    (0, vitest_1.it)("should monitor a11yScore and alert if too low", function () {
        var callback = tractor.observe.mock.calls[0][0];
        callback({
            event: "ui:a11y_audit",
            pluginId: "sloppy-plugin",
            payload: { a11yScore: 0.5 }
        });
        (0, vitest_1.expect)(tractor.emitTelemetry).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            event: "system:alert",
            payload: { reason: vitest_1.expect.stringContaining("Low Accessibility Score"), severity: "warn" }
        }));
    });
});
