import { describe, expect, it, vi } from "vitest";
import { getAliases, baseConfig, resolveMonorepoRoot, withWasmBrowserConfig } from "./index.js";
import path from "node:path";
import fs from "node:fs";

vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn(),
	},
	existsSync: vi.fn(),
}));

describe("@refarm.dev/vtconfig Deterministic Verifications", () => {
	it("should resolve src/index.ts for TS-Strict packages", () => {
		vi.mocked(fs.existsSync).mockImplementation((p) => p.toString().includes("index.ts"));

		const aliases = getAliases("/root");
		expect(aliases["@refarm.dev/tractor"]).toContain("src/index.ts");
	});

	it("should resolve src/index.js for JS-Atomic packages", () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);

		const aliases = getAliases("/root");
		expect(aliases["@refarm.dev/config"]).toContain("src/index.js");
	});

	it("should resolve config plugin-identity through its source subpath", () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);

		const aliases = getAliases("/root");
		expect(aliases["@refarm.dev/config/plugin-identity"]).toBe(
			path.resolve("/root", "packages/config/src/plugin-identity.js"),
		);
	});

	it("should resolve tractor browser through its explicit browser entry", () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);

		const aliases = getAliases("/root");
		expect(aliases["@refarm.dev/tractor/browser"]).toBe(
			path.resolve("/root", "packages/tractor-ts/src/index.browser.ts"),
		);
	});

	it("should resolve dist/index.js when VITEST_USE_DIST is true", () => {
		vi.stubEnv("VITEST_USE_DIST", "true");
		const aliases = getAliases("/root");
		expect(aliases["@refarm.dev/tractor"]).toContain("dist/index.js");
		expect(aliases["@refarm.dev/tractor/browser"]).toContain("dist/src/index.browser.js");
		vi.unstubAllEnvs();
	});

	it("should have globally enabled globals", () => {
		expect(baseConfig.test.globals).toBe(true);
	});

	it("should default to node environment for performance", () => {
		expect(baseConfig.test.environment).toBe("node");
	});

	it("should resolve the monorepo root from its own location, not process.cwd()", () => {
		// Regression guard: baseConfig must NOT compute aliases from
		// process.cwd(), or it breaks under `pnpm --filter <pkg>` (cwd = pkg
		// dir). The root is derived from this file's location instead.
		const root = resolveMonorepoRoot();
		// vtconfig lives at packages/vtconfig/src, so the root ends at the repo.
		expect(fs.existsSync).toBeDefined();
		expect(root.endsWith(path.join("packages", "vtconfig", "src"))).toBe(false);
		// baseConfig's aliases must point under <root>/packages, regardless of cwd.
		const alias = baseConfig.resolve.alias["@refarm.dev/storage-contract-v1"];
		expect(alias.startsWith(path.join(root, "packages"))).toBe(true);
	});

	it("should merge shared browser wasm vite defaults", () => {
		const config = withWasmBrowserConfig({
			optimizeDeps: {
				exclude: ["example-wasm-package"],
			},
		});

		expect(config.assetsInclude).toContain("**/*.wasm");
		expect(config.server.headers["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
		expect(config.preview.headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
		expect(config.optimizeDeps.exclude).toContain("example-wasm-package");
	});
});
