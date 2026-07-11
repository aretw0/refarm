import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SowerCore } from "./core";

// The substrate has no sovereign-dir default; the app injects SOVEREIGN_DIR. Test stands in for the app.
process.env.SOVEREIGN_DIR ||= ".refarm";

describe("SowerCore Scaffolding (Isolated)", () => {
	let tempDir: string;

	beforeEach(() => {
		// Create a unique temporary directory for each test
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sower-test-"));
		vi.stubEnv("REFARM_SITE_URL", "https://aretw0.github.io/refarm");
	});

	afterEach(() => {
		// Cleanup the temporary directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
		vi.unstubAllEnvs();
	});

	it("should hydrate the 'workspace' template correctly", async () => {
		const sower = new SowerCore();
		const projectName = "test-workspace";
		const targetDir = path.join(tempDir, projectName);

		const result = await sower.scaffold("workspace", {
			name: projectName,
			targetDir,
		});

		expect(result).toBeDefined();
		expect(result?.tier).toBe("persistent");
		expect(result?.config.type).toBe("app");

		// Verify files were copied (template has README.md in typescript subpath)
		const readmePath = path.join(targetDir, "README.md");
		expect(fs.existsSync(readmePath)).toBe(true);

		// Verify token substitution
		const readmeContent = fs.readFileSync(readmePath, "utf-8");
		expect(readmeContent).toContain(projectName);
	});

	it("should hydrate the 'rust-plugin' template correctly", async () => {
		const sower = new SowerCore();
		const projectName = "test-rust-plugin";
		const targetDir = path.join(tempDir, projectName);

		const result = await sower.scaffold("rust-plugin", {
			name: projectName,
			targetDir,
		});

		expect(result).toBeDefined();
		expect(result?.tier).toBe("persistent");
		expect(result?.config.type).toBe("plugin");
		expect(result?.config.engine).toBe("heartwood");

		// Verify files were copied (rust-plugin has Cargo.toml)
		expect(fs.existsSync(path.join(targetDir, "Cargo.toml"))).toBe(true);
	});

	it("should skip ignored build/cache output when hydrating templates", async () => {
		const templatesRoot = path.join(tempDir, "templates");
		const templateDir = path.join(templatesRoot, "workspace", "typescript");
		fs.mkdirSync(path.join(templateDir, ".turbo"), { recursive: true });
		fs.writeFileSync(path.join(templateDir, "README.md"), "cache-safe sentinel: {{REFARM_NAME}}");
		fs.writeFileSync(path.join(templateDir, ".turbo", "turbo-build.log"), "cache");

		const sower = new SowerCore({ templatesRoot });
		const targetDir = path.join(tempDir, "hydrated");

		await sower.scaffold("workspace", {
			name: "Cache Safe Workspace",
			targetDir,
		});

		expect(fs.readFileSync(path.join(targetDir, "README.md"), "utf-8")).toContain(
			"cache-safe sentinel: Cache Safe Workspace",
		);
		expect(fs.existsSync(path.join(targetDir, ".turbo", "turbo-build.log"))).toBe(false);
	});

	it("should hydrate templates declared by a public template manifest", async () => {
		const templatesRoot = path.join(tempDir, "templates");
		const templateRoot = path.join(templatesRoot, "custom-plugin");
		const sourceDir = path.join(templateRoot, "template");
		fs.mkdirSync(sourceDir, { recursive: true });
		fs.writeFileSync(
			path.join(templateRoot, "refarm.template.json"),
			JSON.stringify(
				{
					schemaVersion: 1,
					id: "custom-plugin",
					source: "template",
					config: {
						type: "plugin",
						engine: "custom-engine",
					},
				},
				null,
				2,
			),
		);
		fs.writeFileSync(path.join(sourceDir, "README.md"), "{{REFARM_NAME}} / {{REFARM_SLUG}}");

		const sower = new SowerCore({ templatesRoot });
		const targetDir = path.join(tempDir, "custom-plugin-output");

		const result = await sower.scaffold("custom-plugin", {
			name: "Custom Plugin",
			targetDir,
		});

		expect(result.config.type).toBe("plugin");
		expect(result.config.engine).toBe("custom-engine");
		expect(fs.readFileSync(path.join(targetDir, "README.md"), "utf-8")).toBe(
			"Custom Plugin / custom-plugin",
		);
	});

	it("should skip entries excluded by a public template manifest", async () => {
		const templatesRoot = path.join(tempDir, "templates");
		const templateRoot = path.join(templatesRoot, "custom-plugin");
		const sourceDir = path.join(templateRoot, "template");
		fs.mkdirSync(path.join(sourceDir, "internal"), { recursive: true });
		fs.writeFileSync(
			path.join(templateRoot, "refarm.template.json"),
			JSON.stringify(
				{
					schemaVersion: 1,
					id: "custom-plugin",
					source: "template",
					config: {
						type: "plugin",
					},
					exclude: ["internal", "template-only.json"],
				},
				null,
				2,
			),
		);
		fs.writeFileSync(path.join(sourceDir, "README.md"), "{{REFARM_NAME}}");
		fs.writeFileSync(path.join(sourceDir, "template-only.json"), "{}");
		fs.writeFileSync(path.join(sourceDir, "internal", "notes.md"), "internal");

		const sower = new SowerCore({ templatesRoot });
		const targetDir = path.join(tempDir, "custom-plugin-output");

		await sower.scaffold("custom-plugin", {
			name: "Custom Plugin",
			targetDir,
		});

		expect(fs.readFileSync(path.join(targetDir, "README.md"), "utf-8")).toBe("Custom Plugin");
		expect(fs.existsSync(path.join(targetDir, "template-only.json"))).toBe(false);
		expect(fs.existsSync(path.join(targetDir, "internal", "notes.md"))).toBe(false);
	});

	it("should generate correct brand configuration", async () => {
		const sower = new SowerCore();
		const projectName = "My Workspace";
		const targetDir = path.join(tempDir, "my-workspace");

		const result = await sower.scaffold("workspace", {
			name: projectName,
			targetDir,
		});

		expect(result?.config.brand.name).toBe(projectName);
		expect(result?.config.brand.slug).toBe("my-workspace");
	});
});
