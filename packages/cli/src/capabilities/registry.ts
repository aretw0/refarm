import {
	type CapabilityDescriptor,
	type CapabilityEntry,
	isCapabilityGroup,
} from "./types.js";

/**
 * A name lookup for capabilities. Pure data: `has`/`get` touch no I/O, so the
 * REPL parser (which must stay dependency-free) can consult it by name while the
 * effectful surface adapters invoke `run()`. Keys are lowercased because REPL
 * slash names are lowercased before lookup.
 *
 * An entry is either a flat verb (CapabilityDescriptor) or a verb-group
 * (CapabilityGroup); both register under the same name space and collide loudly.
 *
 * `register()` refuses a name that collides with a built-in REPL command, so a
 * capability can never shadow `/model`, `/reload`, etc. (those are dispatched by
 * the chat-repl if-ladder before the registry is consulted; a shadowing name
 * would be silently unreachable). The reserved set is injected so this module
 * does not depend on the REPL module.
 */
export class CapabilityRegistry {
	#byName = new Map<string, CapabilityEntry>();
	#reserved: Set<string>;

	constructor(reservedNames: Iterable<string> = []) {
		this.#reserved = new Set(
			[...reservedNames].map((name) => name.toLowerCase()),
		);
	}

	register(entry: CapabilityEntry): this {
		for (const name of this.#namesOf(entry)) {
			if (this.#reserved.has(name)) {
				throw new Error(
					`Capability name "${name}" collides with a built-in command and would be unreachable`,
				);
			}
			if (this.#byName.has(name)) {
				throw new Error(`Capability name "${name}" is already registered`);
			}
		}
		for (const name of this.#namesOf(entry)) {
			this.#byName.set(name, entry);
		}
		return this;
	}

	has(name: string): boolean {
		return this.#byName.has(name.toLowerCase());
	}

	get(name: string): CapabilityEntry | undefined {
		return this.#byName.get(name.toLowerCase());
	}

	/** All registered entries, de-duplicated (aliases point at one entry). */
	list(): CapabilityEntry[] {
		return [...new Set(this.#byName.values())];
	}

	#namesOf(entry: CapabilityEntry): string[] {
		if (isCapabilityGroup(entry)) {
			// A group reserves only its own verb; sub-actions are addressed as
			// `<group> <sub>`, never as top-level names, so they cannot collide.
			const slashAliases = entry.transports?.repl?.slashAliases ?? [];
			return [entry.name, ...slashAliases].map((name) => name.toLowerCase());
		}
		const slashAliases = entry.transports?.repl?.slashAliases ?? [];
		return [entry.name, ...slashAliases].map((name) => name.toLowerCase());
	}
}

/** Re-export for consumers that only need the flat descriptor type. */
export type { CapabilityDescriptor };
