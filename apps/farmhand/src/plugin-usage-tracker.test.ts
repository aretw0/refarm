import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginUsageTracker } from "./plugin-usage-tracker.js";

describe("PluginUsageTracker", () => {
  let tracker: PluginUsageTracker;

  beforeEach(() => {
    tracker = new PluginUsageTracker();
  });

  describe("isIdle", () => {
    it("returns true for an unknown plugin", () => {
      expect(tracker.isIdle("plugin-a")).toBe(true);
    });

    it("returns false after registerEffort for that plugin", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      expect(tracker.isIdle("plugin-a")).toBe(false);
    });

    it("returns true after the only effort is released", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      tracker.releaseEffort("e1");
      expect(tracker.isIdle("plugin-a")).toBe(true);
    });

    it("remains false while a second effort still holds the plugin", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      tracker.registerEffort("e2", ["plugin-a"]);
      tracker.releaseEffort("e1");
      expect(tracker.isIdle("plugin-a")).toBe(false);
      tracker.releaseEffort("e2");
      expect(tracker.isIdle("plugin-a")).toBe(true);
    });
  });

  describe("releaseEffort", () => {
    it("is a no-op for an unknown effort id", () => {
      expect(() => tracker.releaseEffort("ghost")).not.toThrow();
    });

    it("releases all plugins referenced by the effort", () => {
      tracker.registerEffort("e1", ["plugin-a", "plugin-b"]);
      tracker.releaseEffort("e1");
      expect(tracker.isIdle("plugin-a")).toBe(true);
      expect(tracker.isIdle("plugin-b")).toBe(true);
    });
  });

  describe("onIdle", () => {
    it("fires callback immediately when plugin is already idle", () => {
      const cb = vi.fn();
      tracker.onIdle("plugin-a", cb);
      expect(cb).toHaveBeenCalledOnce();
    });

    it("fires callback when plugin transitions to idle", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      const cb = vi.fn();
      tracker.onIdle("plugin-a", cb);
      expect(cb).not.toHaveBeenCalled();
      tracker.releaseEffort("e1");
      expect(cb).toHaveBeenCalledOnce();
    });

    it("fires exactly once — not on a subsequent idle cycle", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      const cb = vi.fn();
      tracker.onIdle("plugin-a", cb);
      tracker.releaseEffort("e1");
      // re-register + re-release
      tracker.registerEffort("e2", ["plugin-a"]);
      tracker.releaseEffort("e2");
      expect(cb).toHaveBeenCalledOnce();
    });

    it("multiple callbacks all fire when the plugin goes idle", () => {
      tracker.registerEffort("e1", ["plugin-a"]);
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      tracker.onIdle("plugin-a", cb1);
      tracker.onIdle("plugin-a", cb2);
      tracker.releaseEffort("e1");
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });
});
