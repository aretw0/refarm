import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { SowerCore } from "./core";

interface PublicTemplateManifest {
	schemaVersion?: number;
	id?: string;
	source?: string;
	config?: Record<string, unknown>;
	exclude?: string[];
	expectedFiles?: string[];
	forbiddenPaths?: string[];
}

// The substrate has no sovereign-dir default; the app injects SOVEREIGN_DIR. Test stands in for the app.
process.env.SOVEREIGN_DIR ||= ".refarm";

const templatesRoot = path.resolve(__dirname, "../../../templates");

function readManifest(templateId: string): PublicTemplateManifest {
	const manifestPath = path.join(templatesRoot, templateId, "refarm.template.json");
	return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PublicTemplateManifest;
}

function listPublicTemplateIds() {
	return fs
		.readdirSync(templatesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function assertRelativePathList(value: unknown, label: string) {
	expect(Array.isArray(value), `${label} must be an array`).toBe(true);
	for (const entry of value as string[]) {
		expect(typeof entry, `${label} entries must be strings`).toBe("string");
		expect(path.isAbsolute(entry), `${label} entries must be relative`).toBe(false);
		expect(entry.includes(".."), `${label} entries must stay inside the scaffold`).toBe(false);
	}
}

function walkFiles(root: string): string[] {
	const files: string[] = [];
	function walk(current: string) {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			files.push(path.relative(root, fullPath));
		}
	}
	walk(root);
	return files.sort();
}

describe("public Sower template conformance", () => {
	for (const templateId of listPublicTemplateIds()) {
		it(`hydrates ${templateId} according to its manifest contract`, async () => {
			const manifest = readManifest(templateId);

			expect(manifest.schemaVersion).toBe(1);
			expect(manifest.id).toBe(templateId);
			expect(typeof manifest.source).toBe("string");
			assertRelativePathList(manifest.expectedFiles, "expectedFiles");
			assertRelativePathList(manifest.forbiddenPaths, "forbiddenPaths");
			if (manifest.exclude) assertRelativePathList(manifest.exclude, "exclude");
			expect(manifest.expectedFiles?.length).toBeGreaterThan(0);

			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-sower-template-"));
			const targetDir = path.join(tempDir, templateId);

			try {
				const sower = new SowerCore({ templatesRoot });
				await sower.scaffold(templateId, {
					name: `${templateId} conformance`,
					targetDir,
				});

				for (const expectedFile of manifest.expectedFiles ?? []) {
					expect(
						fs.existsSync(path.join(targetDir, expectedFile)),
						`${templateId} should hydrate ${expectedFile}`,
					).toBe(true);
				}

				for (const forbiddenPath of manifest.forbiddenPaths ?? []) {
					expect(
						fs.existsSync(path.join(targetDir, forbiddenPath)),
						`${templateId} must not hydrate ${forbiddenPath}`,
					).toBe(false);
				}

				for (const hydratedFile of walkFiles(targetDir)) {
					const contents = fs.readFileSync(path.join(targetDir, hydratedFile), "utf-8");
					expect(
						contents.includes("{{REFARM_"),
						`${templateId} left an unhydrated token in ${hydratedFile}`,
					).toBe(false);
				}
			} finally {
				fs.rmSync(tempDir, { force: true, recursive: true });
			}
		});
	}
});
