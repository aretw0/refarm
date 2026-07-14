import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
} from "@refarm.dev/capability-host";
import { buildIdeModel, type CapabilityRegistry } from "@refarm.dev/capabilities";

/**
 * `ide` — project the bench into the model a code editor's extension renders: the invocable
 * COMMANDS (VS Code / JetBrains) + a grouped TREE for a side panel. This is the editor face of the
 * declare-once projection — the same registry the CLI, TUI, and web derive from, now as an IDE
 * surface. The example writes no editor code; the projection is @refarm.dev/capabilities'
 * buildIdeModel. A VS Code extension binds each command to a `dgk <name>` invocation.
 *
 * This makes the third surface T1's climax needs (CLI + TUI + IDE) real as DATA: an editor shell
 * consumes this to register the commands + paint the tree.
 */
export function createIdeCapability(registry: () => CapabilityRegistry, namespace = "dgk"): CapabilityDescriptor {
	return {
		name: "ide",
		summary: "Project the bench as an editor command set + tree (the IDE surface)",
		transports: { http: { path: "/ide" } },
		renderers: { tui: { section: "surfaces" } },
		async run(): Promise<CapabilityEnvelope> {
			const model = buildIdeModel(registry(), namespace);
			return buildJsonSuccessEnvelope({
				command: "ide",
				operation: "ide",
				nextCommand: "dgk tui",
				nextCommands: ["dgk tui"],
				extra: {
					namespace: model.namespace,
					commandCount: model.commands.length,
					// The commands an editor extension registers.
					commands: model.commands.map((c) => ({ commandId: c.commandId, title: c.title, group: c.group })),
					// The side-panel tree the extension paints.
					tree: model.tree.map((t) => ({ group: t.group, commands: t.commands.map((c) => c.commandId) })),
				},
			});
		},
	};
}
