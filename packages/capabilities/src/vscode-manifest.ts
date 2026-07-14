import type { IdeModel } from "./ide-projector.js";

/**
 * The VS Code extension MANIFEST generator — turn an IdeModel into the `contributes` block a VS
 * Code extension's package.json declares. This closes the declare-once loop for the editor
 * surface: an app's registry → the IDE model → the extension's contributed commands + tree view,
 * with no hand-written editor manifest. The extension shell binds each contributed command to a
 * `<command> <verb>` invocation; this only shapes the declaration.
 *
 * Pure data — the generated object is written to the extension's package.json. No VS Code API here.
 */

export interface VscodeContributes {
	commands: Array<{ command: string; title: string; category: string; icon?: string }>;
	viewsContainers: { activitybar: Array<{ id: string; title: string; icon: string }> };
	views: Record<string, Array<{ id: string; name: string }>>;
	menus: { commandPalette: Array<{ command: string }> };
}

export interface VscodeExtensionManifest {
	name: string;
	displayName: string;
	description: string;
	version: string;
	engines: { vscode: string };
	categories: string[];
	activationEvents: string[];
	main: string;
	contributes: VscodeContributes;
}

export interface BuildVscodeManifestOptions {
	/** The extension's package name (e.g. "dgk-extension-bench"). */
	name: string;
	displayName: string;
	description: string;
	version?: string;
	/** The activity-bar container id + the tree view id (default derived from the namespace). */
	viewContainerId?: string;
	viewId?: string;
	/** The compiled extension entry (default "./dist/extension.js"). */
	main?: string;
	/** The minimum VS Code engine (default a broad "^1.75.0"). */
	engine?: string;
}

/**
 * Build the VS Code extension manifest from an IdeModel: every command becomes a contributed
 * `command` (in a category named after the namespace) and a palette entry; the tree groups become
 * a single contributed tree view under an activity-bar container. `activationEvents` fire on any
 * contributed command. PURE.
 */
export function buildVscodeManifest(model: IdeModel, options: BuildVscodeManifestOptions): VscodeExtensionManifest {
	const category = model.namespace.toUpperCase();
	const viewContainerId = options.viewContainerId ?? `${model.namespace}-bench`;
	const viewId = options.viewId ?? `${model.namespace}.commands`;

	const commands = model.commands.map((c) => ({
		command: c.commandId,
		title: c.title,
		category,
		...(c.icon ? { icon: `$(${c.icon})` } : {}),
	}));

	return {
		name: options.name,
		displayName: options.displayName,
		description: options.description,
		version: options.version ?? "0.0.1",
		engines: { vscode: options.engine ?? "^1.75.0" },
		categories: ["Other"],
		// Activate when any of the extension's commands is invoked.
		activationEvents: model.commands.map((c) => `onCommand:${c.commandId}`),
		main: options.main ?? "./dist/extension.js",
		contributes: {
			commands,
			viewsContainers: {
				activitybar: [{ id: viewContainerId, title: options.displayName, icon: "$(extensions)" }],
			},
			views: { [viewContainerId]: [{ id: viewId, name: "Comandos" }] },
			menus: { commandPalette: model.commands.map((c) => ({ command: c.commandId })) },
		},
	};
}
