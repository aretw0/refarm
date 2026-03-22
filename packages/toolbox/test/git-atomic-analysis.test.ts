import { describe, it, expect } from "vitest";
import { groupChanges, extractSignals, deriveCommitMessage } from "../src/git-atomic-analysis.mjs";

// Mock getDiffFn: returns a fake diff object based on path
const mockGetDiff = (path: string) => {
  if (path === "package.json") return { raw: 'overrides: { flatted: "3.4.2" }', isNew: false, isDeleted: false };
  if (path.includes("apps/me/tsconfig.json")) return { raw: '"@refarm.dev/homestead/ui": ["../../packages/homestead/src/ui/index.ts"]', isNew: false, isDeleted: false };
  if (path.includes("apps/dev/tsconfig.json")) return { raw: '"@refarm.dev/homestead/sdk": ["../../packages/homestead/src/sdk/index.ts"]', isNew: false, isDeleted: false };
  if (path.includes("composition.bench.ts")) return { raw: '-await tractor10.getPluginApi("MyApi");\n+await tractor10.plugins.findByApi("MyApi");', isNew: false, isDeleted: false };
  if (path.includes("real-instantiation")) return { raw: '-    // @ts-expect-error - JCO generates dynamic exports', isNew: false, isDeleted: false };
  if (path.includes("barn/src/index.ts")) return { raw: 'async installPlugin(url: string, integrity: string)\nasync listPlugins()\nasync uninstallPlugin(id: string)\nsha256\nPluginEntry', isNew: false, isDeleted: false };
  if (path.includes("barn/tests")) return { raw: 'describe("Barn", () => {\n  it("should allow installing", async () => {', isNew: false, isDeleted: false };
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

  it("should group tsconfig files with homestead subpaths into typecheck_fix", () => {
    const changes = ["M  apps/me/tsconfig.json", "M  apps/dev/tsconfig.json"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups.typecheck_fix.items).toHaveLength(2);
  });

  it("should group bench file with plugin-api-rename into test_cleanup", () => {
    const changes = ["M  packages/tractor-ts/test/composition.bench.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups.test_cleanup.items).toHaveLength(1);
  });

  it("should group barn src and tests into barn_impl", () => {
    const changes = ["M  packages/barn/src/index.ts", "M  packages/barn/tests/integration.test.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups.barn_impl.items).toHaveLength(2);
  });

  it("should group barn README into barn_specs", () => {
    const changes = ["M  packages/barn/README.md"];
    const groups = groupChanges(changes, mockGetDiff);
    expect(groups.barn_specs.items).toHaveLength(1);
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
  it("should generate precise message for typecheck_fix group", () => {
    const changes = ["M  apps/me/tsconfig.json", "M  apps/dev/tsconfig.json"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("typecheck_fix", groups.typecheck_fix.items);
    expect(msg).toContain("fix(types):");
    expect(msg).toContain("homestead");
  });

  it("should generate precise message for test_cleanup group", () => {
    const changes = ["M  packages/tractor-ts/test/composition.bench.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("test_cleanup", groups.test_cleanup.items);
    expect(msg).toContain("fix(test):");
    expect(msg).toContain("findByApi");
  });

  it("should generate precise message for barn_impl group", () => {
    const changes = ["M  packages/barn/src/index.ts"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("barn_impl", groups.barn_impl.items);
    expect(msg).toContain("feat(barn):");
    expect(msg).toContain("installPlugin");
  });

  it("should generate a security message for security group", () => {
    const changes = ["M  package.json"];
    const groups = groupChanges(changes, mockGetDiff);
    const msg = deriveCommitMessage("security", groups.security.items);
    expect(msg).toContain("fix(security):");
  });
});
