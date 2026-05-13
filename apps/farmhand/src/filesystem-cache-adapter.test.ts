import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemCacheAdapter } from "./filesystem-cache-adapter.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "farmhand-fs-cache-"),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeBytes(content: string): ArrayBuffer {
  const buf = Buffer.from(content, "utf-8");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("createFilesystemCacheAdapter", () => {
  describe("get", () => {
    it("returns null when plugin is not cached", async () => {
      const adapter = createFilesystemCacheAdapter(createTempDir());
      expect(await adapter.get("my-plugin")).toBeNull();
    });

    it("returns ArrayBuffer for a cached plugin", async () => {
      const baseDir = createTempDir();
      const adapter = createFilesystemCacheAdapter(baseDir);
      const bytes = makeBytes("fake-wasm-content");
      await adapter.set("my-plugin", bytes);
      const result = await adapter.get("my-plugin");
      expect(result).not.toBeNull();
      expect(Buffer.from(result!).toString("utf-8")).toBe("fake-wasm-content");
    });

    it("handles scoped plugin ids like @refarm/pi-agent", async () => {
      const adapter = createFilesystemCacheAdapter(createTempDir());
      const bytes = makeBytes("wasm-bytes");
      await adapter.set("@refarm/pi-agent", bytes);
      const result = await adapter.get("@refarm/pi-agent");
      expect(result).not.toBeNull();
      expect(Buffer.from(result!).toString("utf-8")).toBe("wasm-bytes");
    });
  });

  describe("set", () => {
    it("creates the plugin directory if it does not exist", async () => {
      const baseDir = createTempDir();
      const adapter = createFilesystemCacheAdapter(baseDir);
      await adapter.set("new-plugin", makeBytes("data"));
      const pluginDir = path.join(baseDir, "new-plugin");
      expect(fs.existsSync(pluginDir)).toBe(true);
    });

    it("stores bytes that survive a round-trip through get", async () => {
      const adapter = createFilesystemCacheAdapter(createTempDir());
      const original = makeBytes("round-trip-content");
      await adapter.set("plugin-x", original);
      const retrieved = await adapter.get("plugin-x");
      expect(Buffer.from(retrieved!).toString("utf-8")).toBe("round-trip-content");
    });
  });

  describe("evict", () => {
    it("removes cached bytes so get returns null", async () => {
      const adapter = createFilesystemCacheAdapter(createTempDir());
      await adapter.set("evict-me", makeBytes("data"));
      await adapter.evict("evict-me");
      expect(await adapter.get("evict-me")).toBeNull();
    });

    it("is a no-op for a plugin that was never cached", async () => {
      const adapter = createFilesystemCacheAdapter(createTempDir());
      await expect(adapter.evict("ghost")).resolves.not.toThrow();
    });
  });

  describe("wasmPath", () => {
    it("stores the wasm file at <baseDir>/<pluginId>/plugin.wasm", async () => {
      const baseDir = createTempDir();
      const adapter = createFilesystemCacheAdapter(baseDir);
      await adapter.set("check-path", makeBytes("x"));
      const wasmFile = path.join(baseDir, "check-path", "plugin.wasm");
      expect(fs.existsSync(wasmFile)).toBe(true);
    });
  });
});
