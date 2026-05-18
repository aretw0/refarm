/**
 * L8nHost — Homestead shell internationalization helper.
 *
 * Implements namespaced translation keys with inheritance:
 * - "refarm:core/save" -> core terminology
 * - "plugin-id:welcome" -> plugin-specific terminology
 */
export interface L8nHostLogger {
	info(...args: unknown[]): void;
}

type NodeEnvGlobal = typeof globalThis & {
	process?: { env?: Record<string, string | undefined> };
};

function resolveDefaultLogger(): L8nHostLogger {
	const env = (globalThis as NodeEnvGlobal).process?.env;
	if (env?.VITEST === "true" || env?.NODE_ENV === "test") {
		return { info: () => {} };
	}
	return console;
}

export class L8nHost {
	private readonly namespaces = new Map<string, Record<string, string>>();
	private current = "en";

	constructor(private readonly logger: L8nHostLogger = resolveDefaultLogger()) {
		this.setupCore();
	}

	get currentLocale(): string {
		return this.current;
	}

	getLocale(): string {
		return this.current;
	}

	setLocale(locale: string): void {
		this.current = locale;
		this.logger.info(`[l8n] Locale changed to: ${locale}`);
	}

	registerKeys(namespace: string, keys: Record<string, string>): void {
		const existing = this.namespaces.get(namespace) ?? {};
		this.namespaces.set(namespace, { ...existing, ...keys });
	}

	t(key: string, params?: Record<string, string>): string {
		const { namespace, name } = parseTranslationKey(key);
		const bundle = this.namespaces.get(namespace);
		let value = bundle?.[name] ?? null;

		if (!value && namespace !== "refarm:core") {
			value = this.namespaces.get("refarm:core")?.[name] ?? null;
		}

		if (!value) return key;

		if (params) {
			for (const [param, replacement] of Object.entries(params)) {
				value = value.replace(`{${param}}`, replacement);
			}
		}

		return value;
	}

	private setupCore(): void {
		this.namespaces.set("refarm:core", {
			cancel: "Cancel",
			loading: "Loading...",
			save: "Save",
			status_ready: "Ready",
			unlocked: "Unlocked",
		});
	}
}

function parseTranslationKey(key: string): { namespace: string; name: string } {
	if (key.startsWith("refarm:core/")) {
		return { namespace: "refarm:core", name: key.replace("refarm:core/", "") };
	}

	if (key.includes(":")) {
		const [namespace = "refarm:core", name = key] = key.split(":");
		return { namespace, name };
	}

	if (key.includes("/")) {
		const [namespace = "refarm:core", name = key] = key.split("/");
		return { namespace, name };
	}

	return { namespace: "refarm:core", name: key };
}
