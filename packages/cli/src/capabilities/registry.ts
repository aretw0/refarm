import type { CapabilityDescriptor } from "./types.js";

/**
 * A name lookup for capabilities. Pure data: `has`/`get` touch no I/O, so the
 * REPL parser (which must stay dependency-free) can consult it by name while the
 * effectful surface adapters invoke `run()`. Keys are lowercased because REPL
 * slash names are lowercased before lookup.
 *
 * `register()` refuses a name that collides with a built-in REPL command, so a
 * capability can never shadow `/model`, `/reload`, etc. (those are dispatched by
 * the chat-repl if-ladder before the registry is consulted; a shadowing name
 * would be silently unreachable). The reserved set is injected so this module
 * does not depend on the REPL module.
 */
export class CapabilityRegistry {
	#byName = new Map<string, CapabilityDescriptor>();
	#reserved: Set<string>;

	constructor(reservedNames: Iterable<string> = []) {
		this.#reserved = new Set(
			[...reservedNames].map((name) => name.toLowerCase()),
		);
	}

	register(descriptor: CapabilityDescriptor): this {
		for (const name of this.#namesOf(descriptor)) {
			if (this.#reserved.has(name)) {
				throw new Error(
					`Capability name "${name}" collides with a built-in command and would be unreachable`,
				);
			}
			if (this.#byName.has(name)) {
				throw new Error(`Capability name "${name}" is already registered`);
			}
		}
		for (const name of this.#namesOf(descriptor)) {
			this.#byName.set(name, descriptor);
		}
		return this;
	}

	has(name: string): boolean {
		return this.#byName.has(name.toLowerCase());
	}

	get(name: string): CapabilityDescriptor | undefined {
		return this.#byName.get(name.toLowerCase());
	}

	/** All registered descriptors, de-duplicated (aliases point at one descriptor). */
	list(): CapabilityDescriptor[] {
		return [...new Set(this.#byName.values())];
	}

	#namesOf(descriptor: CapabilityDescriptor): string[] {
		const slashAliases = descriptor.transports?.repl?.slashAliases ?? [];
		return [descriptor.name, ...slashAliases].map((name) =>
			name.toLowerCase(),
		);
	}
}
