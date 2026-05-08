import { SiloCore } from "@refarm.dev/silo";
import { Windmill } from "@refarm.dev/windmill";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SowerCore: The seeding engine of Refarm.
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
	tier: "citizen";
	template: string;
	config: SowerScaffoldConfig;
	identity: { hostingPath: string };
}

export class SowerCore {
	/**
	 * Returns the onboarding steps/intentions as a data-driven structure.
	 */
	getOnboardingFlow() {
		return {
			name: "Cultivate your Soil",
			description: "Choose your level of engagement with the sovereign web.",
			options: [
				{
					id: "guest",
					label: "Guest Mode",
					description:
						"Temporary participation. No keys, no persistent storage.",
					intent: "switch-to-guest",
				},
				{
					id: "citizen",
					label: "Sovereign Citizen",
					description:
						"Full ownership. Sovereign identity (Keys) and persistent storage.",
					intent: "switch-to-citizen",
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
	) {
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

	/**
	 * Scaffolds a new Refarm configuration or project structure.
	 */
	async scaffold(
		templateId: string,
		options: Record<string, unknown> = {},
	): Promise<SowerScaffoldResult> {
		console.log(`[sower-core] Scaffolding template: ${templateId}`, options);

		const name = (options["name"] as string | undefined) || "My Sovereign Farm";
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

		// Template specific adjustments
		let templateSubPath = "typescript"; // Default
		if (templateId === "courier") {
			config.type = "app";
		} else if (templateId === "rust-plugin") {
			config.type = "plugin";
			config.engine = "heartwood";
			templateSubPath = "."; // rust-plugin template doesn't have subdirs yet
		}

		// Hydrate files if targetDir is provided
		if (options["targetDir"]) {
			const templatePath = path.resolve(
				__dirname,
				"../../../templates",
				templateId,
				templateSubPath,
			);

			if (fs.existsSync(templatePath)) {
				const targetDir = options["targetDir"] as string;
				console.log(
					`[sower-core] Hydrating from ${templatePath} to ${targetDir}...`,
				);
				this._copyRecursive(templatePath, targetDir, tokens);
			} else {
				console.warn(`[sower-core] Template path not found: ${templatePath}`);
			}
		}

		return {
			tier: "citizen",
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
	 * Hydrates a configuration from a remote Sovereign Graph node.
	 */
	async hydrateFromRemote(nodeId: string, gatewayUrl: string): Promise<unknown> {
		console.log(
			`[sower-core] Hydrating from remote graph node: ${nodeId} via ${gatewayUrl}`,
		);
		try {
			const response = await fetch(
				`${gatewayUrl}/nodes/${encodeURIComponent(nodeId)}`,
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
