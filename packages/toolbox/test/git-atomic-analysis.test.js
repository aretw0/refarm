import { describe, it, expect } from "vitest";
import { groupChanges, extractSignals, deriveCommitMessage } from "../src/git-atomic-analysis.mjs";

// Mock getDiffFn: returns a fake diff object based on path
const mockGetDiff = (path) => {
  if (path === "package.json") return { raw: '+ overrides: { flatted: "3.4.2" }', isNew: false, isDeleted: false };
  if (path.includes("apps/me/tsconfig.json")) return { raw: '+ "@refarm.dev/homestead/ui": ["../../packages/homestead/src/ui/index.ts"]', isNew: false, isDeleted: false };
  if (path.includes("apps/dev/tsconfig.json")) return { raw: '+ "@refarm.dev/homestead/sdk": ["../../packages/homestead/src/sdk/index.ts"]', isNew: false, isDeleted: false };
  if (path.includes("composition.bench.ts")) return { raw: '-await tractor10.getPluginApi("MyApi");\n+await tractor10.plugins.findByApi("MyApi");', isNew: false, isDeleted: false };
  if (path.includes("real-instantiation")) return { raw: '-    // @ts-expect-error - JCO generates dynamic exports', isNew: false, isDeleted: false };
  if (path.includes("barn/src/index.ts")) return { raw: '+ export function installPlugin(url: string, integrity: string) {}\n+ export function listPlugins() {}\n+ export function uninstallPlugin(id: string) {}\nsha256\nPluginEntry', isNew: false, isDeleted: false };
  if (path.includes("barn/tests")) return { raw: '+ describe("Barn", () => {\n+  it("should allow installing", async () => {', isNew: false, isDeleted: false };
  if (path.includes("barn/README.md")) return { raw: '# Barn', isNew: false, isDeleted: false };
  if (path.includes("git-atomic")) return { raw: 'Refarm Git Atomic Architect v7.0', isNew: false, isDeleted: false };
  return { raw: "", isNew: false, isDeleted: false };
};

describe("Git Atomic Analysis v7.0 — extractSignals", () => {
  it("should detect homestead-subpath signal in tsconfig diff", () => {
    const diff = mockGetDiff("apps/me/tsconfig.json");
    const signals = extractSignals("apps/me/tsconfig.json", diff);
    expect(signals.has("homestead-subpath")).toBe(true);
    expect(signals.has("tsconfig-paths")).toBe(true);
  });

  it("should detect plugin-api-rename signal in bench diff", () => {
    const diff = mockGetDiff("packages/tractor-ts/test/composition.bench.ts");
    const signals = extractSignals("packages/tractor-ts/test/composition.bench.ts", diff);
    expect(signals.has("plugin-api-rename")).toBe(true);
  });

  it("should detect test-ts-cleanup signal in integration test diff", () => {
    const diff = mockGetDiff("packages/tractor-ts/test/real-instantiation.integration.test.ts");
    const signals = extractSignals("packages/tractor-ts/test/real-instantiation.integration.test.ts", diff);
    expect(signals.has("ts-directive")).toBe(true);
  });

  it("should detect barn-api and barn-integrity signals in barn src diff", () => {
    const diff = mockGetDiff("packages/barn/src/index.ts");
    const signals = extractSignals("packages/barn/src/index.ts", diff);
    expect(signals.has("barn-api")).toBe(true);
    expect(signals.has("barn-integrity")).toBe(true);
    expect(signals.has("barn-types")).toBe(true);
  });

  it("should detect security signal in root package.json diff", () => {
    const diff = mockGetDiff("package.json");
    const signals = extractSignals("package.json", diff);
    expect(signals.has("security")).toBe(true);
  });
});

describe("Git Atomic Analysis v7.0 — groupChanges", () => {
  it("should group root security changes correctly", () => {
    const changes = ["M  package.json"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups.security.items).toHaveLength(1);
  });

  it("should group tsconfig files with homestead subpaths into their app scope", () => {
    const changes = ["M  apps/me/tsconfig.json", "M  apps/dev/tsconfig.json"];
    const groups = groupChanges(changes, mockGetDiff);
    // These should now be in their respective package scopes
    expect(groups["scope:me"]).toBeDefined();
    expect(groups["scope:dev"]).toBeDefined();
  });

  it("should group bench file with plugin-api-rename into its package scope", () => {
    const changes = ["M  packages/tractor-ts/test/composition.bench.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups["scope:tractor-ts"]).toBeDefined();
    expect(groups["scope:tractor-ts"].items).toHaveLength(1);
  });

  it("should group barn src and tests into its package scope", () => {
    const changes = ["M  packages/barn/src/index.ts", "M  packages/barn/tests/integration.test.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups["scope:barn"]).toBeDefined();
    expect(groups["scope:barn"].items).toHaveLength(2);
  });

  it("should group barn README into its package scope", () => {
    const changes = ["M  packages/barn/README.md"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups["scope:barn"]).toBeDefined();
    expect(groups["scope:barn"].items).toHaveLength(1);
  });

  it("should group git-atomic changes into toolbox", () => {
    const changes = ["M  packages/toolbox/src/git-atomic-analysis.mjs"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups.toolbox.items).toHaveLength(1);
  });

  it("should handle unknown changes in 'other' group", () => {
    const changes = ["M  random-file.txt"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups.other.items).toHaveLength(1);
  });
});

describe("Git Atomic Analysis v7.0 — deriveCommitMessage", () => {
  it("should generate precise message for scoped module resolution fix", () => {
    const changes = ["M  apps/me/tsconfig.json"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("scope:me", groups["scope:me"].items);
    expect(msg).toContain("fix(me): update module resolution paths");
  });

  it("should generate precise message for scoped test cleanup", () => {
    const changes = ["M  packages/tractor-ts/test/composition.bench.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("scope:tractor-ts", groups["scope:tractor-ts"].items);
    expect(msg).toContain("fix(tractor-ts): clean up tests");
  });

  it("should generate precise message for scoped feature", () => {
    const changes = ["M  packages/barn/src/index.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("scope:barn", groups["scope:barn"].items);
    expect(msg).toContain("feat(barn): implement plugin lifecycle management");
    expect(msg).toContain("installPlugin");
  });

  it("should generate a security message for security group", () => {
    const changes = ["M  package.json"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("security", groups.security.items);
    expect(msg).toContain("fix(security):");
  });
});
describe("Git Atomic Analysis v7.0 — Mixed Context & Scoping", () => {
  const mixedMockGetDiff = (path) => {
    if (path === ".github/workflows/test.yml") return { raw: "name: Test\non: push", isNew: false, isDeleted: false };
    if (path === "vitest.config.js") return { raw: "export default {}", isNew: false, isDeleted: false };
    if (path === "packages/homestead/test/Shell.test.ts") return { raw: "describe('Shell')", isNew: false, isDeleted: false };
    if (path === "packages/homestead/src/Shell.ts") return { raw: "export class Shell {}", isNew: false, isDeleted: false };
    return { raw: "", isNew: false, isDeleted: false };
  };

  it("should prioritize scope over test intent for package files", () => {
    const changes = ["M  packages/homestead/test/Shell.test.ts"];
    const groups = groupChanges(changes, mixedMockGetDiff);
    
    // Should NOT be in test_cleanup if it has a scope
    expect(groups["scope:homestead"]).toBeDefined();
    expect(groups["scope:homestead"].items).toHaveLength(1);
    
    const msg = deriveCommitMessage("scope:homestead", groups["scope:homestead"].items);
    expect(msg).toBe("fix(homestead): clean up tests");
  });

  it("should group multiple changes in the same package together", () => {
    const changes = [
      "M  packages/homestead/src/Shell.ts",
      "M  packages/homestead/test/Shell.test.ts"
    ];
    const groups = groupChanges(changes, mixedMockGetDiff);
    expect(groups["scope:homestead"].items).toHaveLength(2);
  });

  it("should separate infrastructure changes from general misc", () => {
    const changes = [
      "M  .github/workflows/test.yml",
      "M  vitest.config.js"
    ];
    const groups = groupChanges(changes, mixedMockGetDiff);
    
    expect(groups.infra_github).toBeDefined();
    expect(groups.infra_configs).toBeDefined();
  });
});
