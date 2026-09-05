import en from "@refarm.dev/locales/en.json";
import es from "@refarm.dev/locales/es.json";
import ptBR from "@refarm.dev/locales/pt-BR.json";
import { formatMessage, resolveLocale } from "@refarm.dev/localization-v1";

/**
 * L8nHost — Homestead shell internationalization helper.
 *
 * Implements namespaced translation keys with inheritance:
 * - "core/save" -> core terminology
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

		if (!value && namespace !== "core") {
			value = this.namespaces.get("core")?.[name] ?? null;
		}

		if (!value) return key;

		return formatMessage(value, params);
	}

	private setupCore(): void {
		this.namespaces.set("core", {
			cancel: "Cancel",
			loading: "Loading...",
			save: "Save",
			status_ready: "Ready",
			unlocked: "Unlocked",
		});
	}
}

export function createHomesteadL8n(locale = resolveBrowserLocale()): L8nHost {
	const l8n = new L8nHost();
	const selected = resolveLocale([locale]);
	l8n.setLocale(selected);
	l8n.registerKeys("core", en);

	if (selected === "pt-BR") l8n.registerKeys("core", ptBR);
	if (selected === "es") l8n.registerKeys("core", es);

	return l8n;
}

function resolveBrowserLocale(): string {
	const language = typeof navigator === "undefined" ? "en" : navigator.language;
	return language.split("-")[0] || "en";
}

function parseTranslationKey(key: string): { namespace: string; name: string } {
	if (key.includes(":")) {
		const [namespace = "core", name = key] = key.split(":");
		return { namespace, name };
	}

	if (key.includes("/")) {
		const [namespace = "core", name = key] = key.split("/");
		return { namespace, name };
	}

	return { namespace: "core", name: key };
}
