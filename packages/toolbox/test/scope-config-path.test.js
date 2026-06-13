import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scopeScript = fileURLToPath(new URL("../src/scope.mjs", import.meta.url));

describe("scope config path", () => {
  it("does not create config during status when no config exists", () => {
    const root = mkdtempSync(join(tmpdir(), "refarm-scope-config-"));
    try {
      const result = spawnSync(
        process.execPath,
        [scopeScript, "scope", "status", "--format", "json"],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(".refarm/config.json not found");
      expect(existsSync(join(root, ".refarm", "config.json"))).toBe(false);
      expect(existsSync(join(root, "refarm.config.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses canonical .refarm/config.json when present", () => {
    const root = mkdtempSync(join(tmpdir(), "refarm-scope-config-"));
    try {
      mkdirSync(join(root, ".refarm"), { recursive: true });
      writeFileSync(join(root, ".refarm", "config.json"), "{}\n", "utf8");

      const result = spawnSync(
        process.execPath,
        [scopeScript, "scope", "status", "--format", "json"],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        scannedPackages: 0,
        changes: [],
      });
      expect(existsSync(join(root, "refarm.config.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
