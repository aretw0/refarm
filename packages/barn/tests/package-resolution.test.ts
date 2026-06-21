import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolvePluginPackage,
	resolvePluginPackageFromNodeModules,
	resolveWorkspacePluginPackage,
} from "../src/index";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "refarm-barn-resolution-"));
	tempRoots.push(root);
	return root;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("plugin package resolution", () => {
	it("resolves plugin packages from node_modules", async () => {
		const root = await createTempRoot();
		const pkgDir = path.join(root, "node_modules", "@example", "agent-plugin");
		await writeJson(path.join(pkgDir, "package.json"), { name: "@example/agent-plugin" });

		const resolution = resolvePluginPackageFromNodeModules("@example/agent-plugin", {
			baseUrl: path.join(root, "app.mjs"),
		});

		expect(resolution).toEqual({ source: "node_modules", pkgDir });
	});

	it("resolves plugin packages from a declared workspace directory", async () => {
		const root = await createTempRoot();
		const nested = path.join(root, "apps", "refarm");
		const pkgDir = path.join(root, "packages", "pi-agent");
		await mkdir(nested, { recursive: true });
		await writeJson(path.join(pkgDir, "package.json"), { name: "@example/agent-plugin" });

		const resolution = resolveWorkspacePluginPackage(
			{ npmPackage: "@example/agent-plugin", workspaceDir: "packages/pi-agent" },
			{ cwd: nested },
		);

		expect(resolution).toEqual({ source: "workspace", pkgDir });
	});

	it("does not resolve workspace directories with a mismatched package name", async () => {
		const root = await createTempRoot();
		const pkgDir = path.join(root, "packages", "pi-agent");
		await writeJson(path.join(pkgDir, "package.json"), { name: "@example/other" });

		const resolution = resolveWorkspacePluginPackage(
			{ npmPackage: "@example/agent-plugin", workspaceDir: "packages/pi-agent" },
			{ cwd: root },
		);

		expect(resolution).toBeNull();
	});

	it("prefers node_modules and falls back to workspace when node_modules is unavailable", async () => {
		const root = await createTempRoot();
		const workspacePkgDir = path.join(root, "packages", "pi-agent");
		await writeJson(path.join(workspacePkgDir, "package.json"), {
			name: "@example/agent-plugin",
		});

		expect(
			resolvePluginPackage(
				{ npmPackage: "@example/agent-plugin", workspaceDir: "packages/pi-agent" },
				{ cwd: root, baseUrl: path.join(root, "app.mjs") },
			),
		).toEqual({ source: "workspace", pkgDir: workspacePkgDir });

		const nodeModulesPkgDir = path.join(root, "node_modules", "@example", "agent-plugin");
		await writeJson(path.join(nodeModulesPkgDir, "package.json"), {
			name: "@example/agent-plugin",
		});

		expect(
			resolvePluginPackage(
				{ npmPackage: "@example/agent-plugin", workspaceDir: "packages/pi-agent" },
				{ cwd: root, baseUrl: path.join(root, "app.mjs") },
			),
		).toEqual({ source: "node_modules", pkgDir: nodeModulesPkgDir });
	});
});
