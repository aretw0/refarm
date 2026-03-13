/**
 * Refarm Command Host — Governance for Intent-based Actions.
 * 
 * Supports VSCode-like 'Ctrl+P' / '>' experiences (Quick Open & Command Palette).
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

export type CommandHandler = (args?: any) => Promise<any> | any;

export interface RegisteredCommand extends CommandMetadata {
  handler: CommandHandler;
}

export class CommandHost {
  private commands: Map<string, RegisteredCommand> = new Map();

  constructor(private emitTelemetry: (event: string, payload?: any) => void) {}

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
   * Execute a command by ID.
   */
  async execute(id: string, args?: any): Promise<any> {
    const cmd = this.commands.get(id);
    if (!cmd) {
      throw new Error(`[commands] Command not found: ${id}`);
    }

    try {
      const startTime = performance.now();
      const result = await cmd.handler(args);
      
      this.emitTelemetry("system:command_executed", {
        id,
        durationMs: performance.now() - startTime,
        success: true
      });

      return result;
    } catch (error: any) {
      this.emitTelemetry("system:command_failed", {
        id,
        error: error.message,
        success: false
      });
      throw error;
    }
  }

  /**
   * List all registered commands (for the palette).
   */
  getCommands(): CommandMetadata[] {
    return Array.from(this.commands.values()).map(({ handler, ...metadata }) => metadata);
  }
}
