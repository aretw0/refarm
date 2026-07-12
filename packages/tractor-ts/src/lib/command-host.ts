/**
 * Refarm Command Host — Governance for Intent-based Actions.
 *
 * Supports VSCode-like 'Ctrl+P' / '>' experiences (Quick Open & Command Palette).
 *
 * This is the SURFACE-side "Sovereign Intent Layer" (ADR-033): a registry of
 * user-facing intents a shell projects into a Command Palette. It is intentionally
 * TS/browser-side — commands are a UI concept, not a runtime one; the authoritative
 * Rust `tractor` governs plugin ADMISSION separately (trust + capability grants).
 * What this layer governs is which intents a caller may EXECUTE (§3) and how a plugin
 * may EXTEND an existing intent (§2).
 */

export interface CommandMetadata {
	/** Unique identifier for the command (e.g., 'system:identity:sign'). */
	id: string;
	/** Human-readable title (for command palette). */
	title: string;
	/** Grouping for the UI. */
	category?: string;
	/** Brief explanation of what the command does. */
	description?: string;
	/** Keyboard shortcut (standard format). */
	shortcut?: string;
	/** Capability required to run this command (for safety). */
	capability?: string;
	/** Metadata about the source. */
	sourcePlugin?: string;
}

export type CommandHandler = (args?: unknown) => Promise<unknown> | unknown;

export interface RegisteredCommand extends CommandMetadata {
	handler: CommandHandler;
}

/**
 * The governance gate (ADR-033 §3): given a command's required `capability`, decide
 * whether the current caller may run it. Returns true to allow. A CommandHost built
 * WITHOUT a gate is permissive (every command runs) — the pre-governance behaviour,
 * kept so existing callers are unchanged. A command with no `capability` is always
 * allowed (an ungoverned intent); the gate is consulted only for commands that
 * declare one.
 */
export type CapabilityGate = (capability: string) => boolean;

/**
 * A decoration (ADR-033 §2): wrap an existing command's handler to refine its
 * behaviour (e.g. a "Vim" plugin decorating `editor:save`). Receives the current
 * handler (the "inner"/previous) and returns the replacement, so decorations compose
 * — each new one wraps whatever is there now, innermost = the original.
 */
export type CommandDecorator = (inner: CommandHandler) => CommandHandler;

export class CommandDeniedError extends Error {
	constructor(
		readonly commandId: string,
		readonly capability: string,
	) {
		super(`[commands] Denied: "${commandId}" requires capability "${capability}"`);
		this.name = "CommandDeniedError";
	}
}

export class CommandHost {
	private commands: Map<string, RegisteredCommand> = new Map();

	/**
	 * @param emitTelemetry sink for `system:command_*` events.
	 * @param capabilityGate optional governance gate (ADR-033 §3). Omit for the
	 *   permissive default (every command runs regardless of its `capability`).
	 */
	constructor(
		private emitTelemetry: (event: string, payload?: unknown) => void,
		private capabilityGate?: CapabilityGate,
	) {}

	/**
	 * Register a new command in the system.
	 */
	register(command: RegisteredCommand) {
		if (this.commands.has(command.id)) {
			console.warn(`[commands] Overwriting command: ${command.id}`);
		}
		this.commands.set(command.id, command);

		this.emitTelemetry("system:command_registered", { id: command.id, title: command.title });
	}

	/**
	 * DECORATE an existing command (ADR-033 §2): replace its handler with
	 * `decorator(currentHandler)`, so a plugin can refine an intent without
	 * discarding the original. Decorations stack (each wraps the current handler).
	 * All other metadata (capability, title, …) is preserved. Throws if the command
	 * does not exist — you decorate what is there, you do not create by decorating.
	 */
	decorate(id: string, decorator: CommandDecorator) {
		const existing = this.commands.get(id);
		if (!existing) {
			throw new Error(`[commands] Cannot decorate unknown command: ${id}`);
		}
		this.commands.set(id, { ...existing, handler: decorator(existing.handler) });
		this.emitTelemetry("system:command_decorated", { id });
	}

	/**
	 * Get a registered command by ID.
	 */
	get(id: string): RegisteredCommand | undefined {
		return this.commands.get(id);
	}

	/**
	 * Unregister a command (e.g., when a plugin is unloaded).
	 */
	unregister(id: string) {
		this.commands.delete(id);
	}

	/**
	 * Whether the current caller may run `id` — the governance decision (ADR-033 §3)
	 * without executing. A missing command is not runnable; a command with no
	 * `capability`, or when no gate is configured, is allowed; otherwise the gate
	 * decides. Lets a UI grey out / flag commands the caller can't run.
	 */
	canExecute(id: string): boolean {
		const cmd = this.commands.get(id);
		if (!cmd) return false;
		if (!cmd.capability || !this.capabilityGate) return true;
		return this.capabilityGate(cmd.capability);
	}

	/**
	 * Execute a command by ID — governance-checked (ADR-033 §3). If the command
	 * declares a `capability` and a gate is configured, the gate must allow it or
	 * this throws `CommandDeniedError` (and emits `system:command_denied`) BEFORE the
	 * handler runs. This is the enforcement the registry previously lacked — a
	 * sensitive intent (e.g. `system:security:*`) can now require a capability.
	 */
	async execute(id: string, args?: unknown): Promise<unknown> {
		const cmd = this.commands.get(id);
		if (!cmd) {
			throw new Error(`[commands] Command not found: ${id}`);
		}

		if (cmd.capability && this.capabilityGate && !this.capabilityGate(cmd.capability)) {
			this.emitTelemetry("system:command_denied", { id, capability: cmd.capability });
			throw new CommandDeniedError(id, cmd.capability);
		}

		try {
			const startTime = performance.now();
			const result = await cmd.handler(args);

			this.emitTelemetry("system:command_executed", {
				id,
				durationMs: performance.now() - startTime,
				success: true,
			});

			return result;
		} catch (error) {
			this.emitTelemetry("system:command_failed", {
				id,
				error: error instanceof Error ? error.message : String(error),
				success: false,
			});
			throw error;
		}
	}

	/**
	 * List all registered commands (for the palette). Each carries an `ariaLabel`
	 * (ADR-033 §4) derived from its title + description, so a shell can announce the
	 * intent to a screen reader without re-deriving it, and a `runnable` flag from the
	 * governance gate (§3) so the palette can present but disable what the caller
	 * can't run.
	 */
	getCommands(): Array<CommandMetadata & { ariaLabel: string; runnable: boolean }> {
		return Array.from(this.commands.values()).map(({ handler: _handler, ...metadata }) => ({
			...metadata,
			ariaLabel: ariaLabelFor(metadata),
			runnable: this.canExecute(metadata.id),
		}));
	}
}

/** Derive a screen-reader label (ADR-033 §4) from a command's title + description. */
function ariaLabelFor(meta: CommandMetadata): string {
	const base = meta.category ? `${meta.category}: ${meta.title}` : meta.title;
	return meta.description ? `${base}. ${meta.description}` : base;
}
