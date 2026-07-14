import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
} from "@refarm.dev/capability-host";
import { buildIdeModel, buildVscodeManifest, type CapabilityRegistry } from "@refarm.dev/capabilities";

/**
 * `vscode-manifest [--apply]` — generate the VS Code extension's package.json `contributes` from
 * the bench's registry. The developer "builds the extension" without hand-writing its manifest: the
 * same declaration that drives the CLI/TUI/IDE-model becomes the editor extension's contributed
 * commands + tree view. With `--apply` it writes the manifest next to the extension shell; without
 * it, it reports the manifest. The generator is the platform's (@refarm.dev/capabilities); this
 * example only supplies the extension's name/description + the writer.
 */
export interface VscodeVerbOptions {
	/** Persist the generated package.json (injected by the CLI — a node fs writer). */
	writeManifest?: (json: string) => void | Promise<void>;
}

export function createVscodeManifestCapability(
	registry: () => CapabilityRegistry,
	namespace = "dgk",
	options: VscodeVerbOptions = {},
): CapabilityDescriptor {
	return {
		name: "vscode-manifest",
		summary: "Generate the VS Code extension package.json from the bench (declare once → editor)",
		options: [{ name: "apply", kind: "boolean", summary: "Write the manifest to the extension shell" }],
		transports: { http: { path: "/vscode/manifest" } },
		renderers: { tui: { section: "surfaces" } },
		async run(input): Promise<CapabilityEnvelope> {
			const model = buildIdeModel(registry(), namespace);
			const manifest = buildVscodeManifest(model, {
				name: `${namespace}-extension-bench`,
				displayName: "Extension Bench",
				description: "The extension bench's verbs, as VS Code commands + a tree view (declare once → editor).",
			});
			const json = JSON.stringify(manifest, null, 2);
			const apply = (input.options as { apply?: boolean } | undefined)?.apply === true;
			let written = false;
			if (apply && options.writeManifest) {
				await options.writeManifest(json);
				written = true;
			}
			return buildJsonSuccessEnvelope({
				command: "vscode-manifest",
				operation: "vscode-manifest",
				nextCommand: "dgk ide",
				nextCommands: ["dgk ide"],
				extra: {
					commandCount: manifest.contributes.commands.length,
					viewContainer: manifest.contributes.viewsContainers.activitybar[0]?.id,
					written,
					manifest,
				},
			});
		},
	};
}
