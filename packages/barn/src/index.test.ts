/**
 * ISS-094. `refarm plugin list --json` reported the node's own bundled plugin as packageSource
 * "workspace" with a packageDir inside this checkout, and as "unresolved" with packageDir null from
 * anywhere else — while `plugin status`, which reports what the daemon has LOADED, stayed identical
 * from all three directories. So the node knew its plugin's provenance and `list` re-derived it from
 * wherever the operator happened to be standing. "unresolved" is what an operator reads before
 * deciding whether a plugin is trustworthy.
 *
 * These tests live on the PURE resolver rather than on `buildPluginListReport`, and that is a
 * measured choice: under vitest the `node_modules` branch resolves regardless of the working
 * directory, so an app-level test would have passed without ever exercising the branch that breaks.
 * Verified against the built CLI instead — `dist` reports `workspace` from the repo and
 * `unresolved` from /tmp — and the integration claim is made by
 * `scripts/directory-independence.mjs`, which runs the real binary from three real directories.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveWorkspacePluginPackage } from "./index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("resolveWorkspacePluginPackage walks from the cwd it is GIVEN (ISS-094)", () => {
	// The npm package name is `@refarm.dev/agent`; `@refarm/agent` is the PLUGIN id. The resolver
	// matches on package.json's `name`, so using the plugin id here silently returns null — which is
	// how this test first passed the negative case and failed the positive one.
	const plugin = { npmPackage: "@refarm.dev/agent", workspaceDir: "packages/agent" };

	it("resolves from a directory nested deep inside the workspace", () => {
		const resolution = resolveWorkspacePluginPackage(plugin, {
			cwd: path.join(REPO_ROOT, "apps", "refarm", "src", "commands"),
		});
		expect(resolution?.source).toBe("workspace");
		expect(resolution?.pkgDir).toBe(path.join(REPO_ROOT, "packages", "agent"));
	});

	it("resolves identically from the workspace root and from a subdirectory of it", () => {
		expect(resolveWorkspacePluginPackage(plugin, { cwd: REPO_ROOT })).toEqual(
			resolveWorkspacePluginPackage(plugin, { cwd: path.join(REPO_ROOT, "apps", "refarm") }),
		);
	});

	it("returns null from a directory unrelated to the workspace — which is WHY the caller must not hand it its own cwd", () => {
		expect(resolveWorkspacePluginPackage(plugin, { cwd: os.tmpdir() })).toBeNull();
	});
});
