import { describe, expect, it } from "vitest";
import {
  createHomesteadHostRendererDescriptor,
} from "@refarm.dev/homestead/sdk/host-renderer";
import { createNullTrustSummary } from "@refarm.dev/trust";
import { createNullRuntimeSummary } from "@refarm.dev/runtime";
import { buildRefarmStatusJson } from "./status.js";

const HEADLESS_RENDERER = createHomesteadHostRendererDescriptor(
  "refarm-headless",
  "headless",
);

const BASE_OPTIONS = {
  host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
  renderer: HEADLESS_RENDERER,
  runtime: createNullRuntimeSummary(),
  trust: createNullTrustSummary(),
};

describe("buildRefarmStatusJson", () => {
  it("emits schemaVersion 1 always", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).schemaVersion).toBe(1);
  });

  it("maps host fields directly", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).host).toEqual({
      app: "apps/refarm",
      command: "refarm",
      profile: "dev",
      mode: "headless",
    });
  });

  it("maps renderer id, kind, and capabilities from descriptor", () => {
    const result = buildRefarmStatusJson(BASE_OPTIONS);
    expect(result.renderer.id).toBe("refarm-headless");
    expect(result.renderer.kind).toBe("headless");
    expect(result.renderer.capabilities).toContain("telemetry");
    expect(result.renderer.capabilities).toContain("diagnostics");
  });

  it("defaults all plugin counts to zero when no snapshot is provided", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).plugins).toEqual({
      installed: 0,
      active: 0,
      rejectedSurfaces: 0,
      surfaceActions: 0,
    });
  });

  it("derives rejectedSurfaces and surfaceActions from snapshot surfaces", () => {
    const result = buildRefarmStatusJson({
      ...BASE_OPTIONS,
      plugins: {
        surfaces: {
          rejected: [{ reason: "untrusted-plugin", pluginId: "plugin-a" }],
          actions: [
            { actionId: "open-node", status: "requested", pluginId: "plugin-b" },
            { actionId: "close-node", status: "failed", pluginId: "plugin-c" },
          ],
        },
      },
    });
    expect(result.plugins.rejectedSurfaces).toBe(1);
    expect(result.plugins.surfaceActions).toBe(2);
  });

  it("defaults streams to zero when not provided", () => {
    expect(buildRefarmStatusJson(BASE_OPTIONS).streams).toEqual({ active: 0, terminal: 0 });
  });

  it("maps streams active and terminal from stream state", () => {
    const result = buildRefarmStatusJson({
      ...BASE_OPTIONS,
      streams: { active: 3, terminal: 1 },
    });
    expect(result.streams).toEqual({ active: 3, terminal: 1 });
  });

  it("adds renderer:non-interactive and renderer:no-rich-html for headless renderer", () => {
    const diagnostics = buildRefarmStatusJson(BASE_OPTIONS).diagnostics;
    expect(diagnostics).toContain("renderer:non-interactive");
    expect(diagnostics).toContain("renderer:no-rich-html");
  });

  it("emits no renderer diagnostics for web renderer", () => {
    const webRenderer = createHomesteadHostRendererDescriptor("refarm-web", "web");
    const diagnostics = buildRefarmStatusJson({ ...BASE_OPTIONS, renderer: webRenderer }).diagnostics;
    expect(diagnostics).not.toContain("renderer:non-interactive");
    expect(diagnostics).not.toContain("renderer:no-rich-html");
  });

  it("passes through null trust and runtime stubs unchanged", () => {
    const result = buildRefarmStatusJson(BASE_OPTIONS);
    expect(result.trust).toEqual({ profile: "dev", warnings: 0, critical: 0 });
    expect(result.runtime).toEqual({ ready: false, databaseName: "", namespace: "" });
  });
});
