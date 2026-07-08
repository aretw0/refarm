import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SowerCore: public onboarding, workspace scaffold, and import helpers.
 * Handles templates, interactive flows, and initial project structure.
 * Designed to be runtime-neutral (CLI, Browser, or Server).
 */

export interface SowerScaffoldConfig {
	mode: string;
	storage: string;
	brand: { name: string; slug: string };
	type?: string;
	engine?: string;
}

export interface SowerScaffoldResult {
	tier: "persistent";
	template: string;
	config: SowerScaffoldConfig;
	identity: { hostingPath: string };
}

export interface SowerCoreOptions {
	templatesRoot?: string;
}

interface SowerTemplateManifest {
	schemaVersion?: number;
	id?: string;
	source?: string;
	config?: Partial<Pick<SowerScaffoldConfig, "type" | "engine">>;
	exclude?: string[];
	expectedFiles?: string[];
	forbiddenPaths?: string[];
}

function normalizeTemplatePath(value: string) {
	return value.split(path.sep).join("/");
}

export class SowerCore {
	private readonly templatesRoot: string;

	constructor(options: SowerCoreOptions = {}) {
		this.templatesRoot = options.templatesRoot ?? path.resolve(__dirname, "../../../templates");
	}

	/**
	 * Returns the onboarding steps/intentions as a data-driven structure.
	 */
	getOnboardingFlow() {
		return {
			name: "Set up your workspace",
			description: "Choose how this Refarm workspace should persist data.",
			options: [
				{
					id: "guest",
					label: "Guest Mode",
					description:
						"Temporary participation. No keys, no persistent storage.",
					intent: "switch-to-guest",
				},
				{
					id: "persistent",
					label: "Persistent Workspace",
					description:
						"Persistent identity and local storage for ongoing work.",
					intent: "switch-to-persistent",
				},
			],
		};
	}

	/**
	 * Helper to recursively copy directories with token substitution.
	 */
	private _copyRecursive(
		src: string,
		dest: string,
		tokens: Record<string, string> = {},
		excludedPaths: Set<string> = new Set(),
		sourceRoot: string = src,
	) {
		if (this._shouldSkipTemplateEntry(path.basename(src))) return;
		const relativeSourcePath = normalizeTemplatePath(path.relative(sourceRoot, src));
		if (relativeSourcePath && excludedPaths.has(relativeSourcePath)) return;

		const exists = fs.existsSync(src);
		const stats = exists && fs.statSync(src);
		const isDirectory = exists && stats && stats.isDirectory();

		if (isDirectory) {
			if (!fs.existsSync(dest)) {
				fs.mkdirSync(dest, { recursive: true });
			}
			fs.readdirSync(src).forEach((child) => {
				this._copyRecursive(
					path.join(src, child),
					path.join(dest, child),
					tokens,
					excludedPaths,
					sourceRoot,
				);
			});
		} else {
			// For files, read content, replace tokens, and write to dest
			const content = fs.readFileSync(src, "utf-8");
			let hydratedContent = content;

			for (const [key, value] of Object.entries(tokens)) {
				const regex = new RegExp(`{{${key}}}`, "g");
				hydratedContent = hydratedContent.replace(regex, value);
			}

			fs.writeFileSync(dest, hydratedContent);
		}
	}

	private _shouldSkipTemplateEntry(name: string) {
		return [".astro", ".turbo", "dist", "node_modules"].includes(name);
	}

	private _readTemplateManifest(templateId: string): SowerTemplateManifest | null {
		const manifestPath = path.resolve(
			this.templatesRoot,
			templateId,
			"refarm.template.json",
		);
		if (!fs.existsSync(manifestPath)) return null;
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as SowerTemplateManifest;
		if (manifest.id && manifest.id !== templateId) {
			throw new Error(
				`Template manifest id mismatch: expected ${templateId}, got ${manifest.id}`,
			);
		}
		return manifest;
	}

	private _resolveTemplate(templateId: string): {
		source: string;
		config: Partial<Pick<SowerScaffoldConfig, "type" | "engine">>;
		exclude: string[];
	} {
		const manifest = this._readTemplateManifest(templateId);
		if (manifest) {
			return {
				source: manifest.source ?? ".",
				config: manifest.config ?? {},
				exclude: manifest.exclude ?? [],
			};
		}
		if (templateId === "workspace") {
			return {
				source: "typescript",
				config: { type: "app" },
				exclude: [],
			};
		}
		if (templateId === "rust-plugin") {
			return {
				source: ".",
				config: { type: "plugin", engine: "heartwood" },
				exclude: [],
			};
		}
		return {
			source: "typescript",
			config: {},
			exclude: [],
		};
	}

	/**
	 * Scaffolds a new Refarm configuration or project structure.
	 */
	async scaffold(
		templateId: string,
		options: Record<string, unknown> = {},
	): Promise<SowerScaffoldResult> {
		console.log(`[sower-core] Scaffolding template: ${templateId}`, options);

		const name = (options["name"] as string | undefined) || "My Workspace";
		const config: SowerScaffoldConfig = {
			mode: "persistent",
			storage: "opfs",
			brand: {
				name,
				slug: name.toLowerCase().replace(/\s+/g, "-"),
			},
		};

		// Hydration tokens
		const brand = config.brand;
		const tokens: Record<string, string> = {
			REFARM_NAME: brand.name,
			REFARM_SLUG: brand.slug,
		};

		const template = this._resolveTemplate(templateId);
		Object.assign(config, template.config);

		// Hydrate files if targetDir is provided
		if (options["targetDir"]) {
			const templatePath = path.resolve(
				this.templatesRoot,
				templateId,
				template.source,
			);

			if (fs.existsSync(templatePath)) {
				const targetDir = options["targetDir"] as string;
				console.log(
					`[sower-core] Hydrating from ${templatePath} to ${targetDir}...`,
				);
				this._copyRecursive(
					templatePath,
					targetDir,
					tokens,
					new Set(template.exclude.map((entry) => normalizeTemplatePath(entry))),
					templatePath,
				);
			} else {
				console.warn(`[sower-core] Template path not found: ${templatePath}`);
			}
		}

		return {
			tier: "persistent",
			template: templateId,
			config,
			identity: {
				hostingPath: ".refarm/identity.json",
			},
		};
	}

	/**
	 * Sows the project with tokens and verifies infrastructure.
	 */
	async sow(
		tokens: { githubToken: string; cloudflareToken: string },
		brand: { owner: string },
	) {
		console.log(`[sower-core] Sowing tokens for ${brand.owner}...`);

		const silo = new SiloCore();
		await silo.saveTokens(tokens);

		// Temporarily set env for verification
		process.env.GITHUB_TOKEN = tokens.githubToken;
		process.env.CLOUDFLARE_API_TOKEN = tokens.cloudflareToken;

		const windmill = new Windmill({
			brand: { owner: brand.owner, urls: { repository: "" } },
			infrastructure: { gitHost: "github" },
		});

		const results: Record<
			string,
			{ ok: boolean; count?: number; error?: string }
		> = {
			github: { ok: false },
			cloudflare: { ok: true },
		};

		try {
			const repos = await windmill.github.listRepos();
			results.github = { ok: true, count: repos.length };
		} catch (e) {
			results.github = {
				ok: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}

		return results;
	}

	/**
	 * Hydrates a configuration from a remote graph node.
	 */
	async hydrateFromRemote(nodeId: string, gatewayUrl: string): Promise<unknown> {
		const timeoutMs = 20_000;
		console.log(
			`[sower-core] Hydrating from remote graph node: ${nodeId} via ${gatewayUrl}`,
		);
		try {
			const response = await fetch(
				`${gatewayUrl}/nodes/${encodeURIComponent(nodeId)}`,
				{ signal: AbortSignal.timeout(timeoutMs) },
			);
			if (!response.ok) {
				throw new Error(`Failed to fetch graph node: ${response.statusText}`);
			}

			const node = await response.json();
			// Extract refarm-specific configuration from the JSON-LD node
			return {
				tier: node["refarm:tier"] || "guest",
				config: node["refarm:config"] || {},
				plugins: node["refarm:recommendedPlugins"] || [],
			};
		} catch (e) {
			throw new Error(
				`Remote hydration failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
}
