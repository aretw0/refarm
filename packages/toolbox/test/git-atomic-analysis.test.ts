import { describe, it, expect } from "vitest";
import { groupChanges } from "../src/git-atomic-analysis.mjs";

const mockGetContext = (path: string) => {
  // Simular que apenas o package.json da RAIZ tem contexto de segurança
  if (path === "package.json") return "Security/Audit";
  if (path.includes("heartwood")) return "Heartwood/WASM";
  if (path.includes(".test.ts")) return "Vitest/Testing";
  if (path.includes("Barn") || path.includes("SCHEMA")) return "Barn/Specs";
  return null;
};

describe("Git Atomic Analysis Logic v6.2 (Full Monorepo Coverage)", () => {
  it("should group root security changes correctly", () => {
    const changes = ["M  package.json"];
    const groups = groupChanges(changes, mockGetContext);
    expect(groups.security.items).toHaveLength(1);
  });

  it("should group Barn specs correctly with high priority", () => {
    const changes = ["M  packages/barn/README.md"];
    const groups = groupChanges(changes, mockGetContext);
    expect(groups.barn_specs.items).toHaveLength(1);
  });

  it("should group Proposals correctly", () => {
    const changes = ["?? docs/proposals/NEW_IDEA.md"];
    const groups = groupChanges(changes, mockGetContext);
    expect(groups.proposals.items).toHaveLength(1);
  });

  it("should group Package updates correctly (Fixing regression)", () => {
    const changes = ["M  packages/identity-nostr/package.json"];
    const groups = groupChanges(changes, mockGetContext);
    // Deve ir para pkg_updates porque o mockGetContext retorna null para este path
    expect(groups.pkg_updates.items).toHaveLength(1);
  });

  it("should handle unknown changes in 'other' group", () => {
    const changes = ["M  random-file.txt"];
    const groups = groupChanges(changes, mockGetContext);
    expect(groups.other.items).toHaveLength(1);
  });
});
