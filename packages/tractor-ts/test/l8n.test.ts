import { describe, expect, it } from "vitest";
import { L8nHost } from "../src/lib/l8n-host";

describe("L8nHost", () => {
  it("initializes with core keys", () => {
    const l8n = new L8nHost();
    expect(l8n.t("refarm:core/save")).toBe("Save");
    expect(l8n.t("save")).toBe("Save"); // implicit core
  });

  it("registers and translates plugin namespaces", () => {
    const l8n = new L8nHost();
    l8n.registerKeys("my-plugin", { "welcome": "Hello World" });
    
    expect(l8n.t("my-plugin:welcome")).toBe("Hello World");
  });

  it("inherits from core when plugin key is missing", () => {
    const l8n = new L8nHost();
    l8n.registerKeys("my-plugin", { "local": "Local" });
    
    // "save" exists in core but not in my-plugin
    expect(l8n.t("my-plugin:save")).toBe("Save");
  });

  it("replaces parameters correctly", () => {
    const l8n = new L8nHost();
    l8n.registerKeys("my-plugin", { "greet": "Hello {name}!" });
    
    expect(l8n.t("my-plugin:greet", { name: "Antigravity" })).toBe("Hello Antigravity!");
  });

  it("falls back to key if not found anywhere", () => {
    const l8n = new L8nHost();
    expect(l8n.t("unknown:key")).toBe("unknown:key");
  });

  it("switches locale", () => {
    const l8n = new L8nHost();
    l8n.setLocale("pt-BR");
    expect(l8n.currentLocale).toBe("pt-BR");
  });
});
