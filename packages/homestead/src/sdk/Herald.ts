/// <reference lib="dom" />
import { createHomesteadL8n, type L8nHost } from "./l8n-host.js";
import type { StudioHost, StudioHostTelemetryEvent } from "./studio-host.js";

type ViteImportMeta = ImportMeta & { env?: { VITE_REFARM_VERSION?: string } };

export const HOMESTEAD_ENGINE_VERSION: string =
	(import.meta as ViteImportMeta).env?.VITE_REFARM_VERSION || "0.1.0-dev";

export interface HeraldPluginOptions {
	l8n?: L8nHost;
	identityStatus?: string;
}

export const HERALD_DEFAULT_IDENTITY_STATUS = "unauthenticated";
export const HERALD_IDENTITY_STATUS_ID = "refarm-herald-identity-status";

/**
 * Herald plugin.
 *
 * Responsible for presenting the Refarm identity and loaded plugins.
 */
export class HeraldPlugin {
	private _logs: string[] = [];
	private readonly l8n: L8nHost;
	private readonly identityStatus: string;

	constructor(
		private tractor: StudioHost,
		options: HeraldPluginOptions = {},
	) {
		this.l8n = options.l8n ?? createHomesteadL8n();
		this.identityStatus = options.identityStatus ?? HERALD_DEFAULT_IDENTITY_STATUS;
		this.setupHerald();
		this.renderIdentityStatus();
	}

	private setupHerald() {
		this.tractor.observe((data: StudioHostTelemetryEvent) => {
			if (data.event === "plugin:load") {
				const plugin = this.tractor.plugins.get(data.pluginId!);
				const version = plugin?.manifest.version || "0.0.0";
				const info = `  🚜 [plugin] ${data.pluginId} v${version}`;
				this._logs.push(info);
			}
		});
	}

	private renderIdentityStatus() {
		if (typeof document === "undefined") return;

		const text = `Identity: ${this.identityStatus}`;
		const existing = document.getElementById(HERALD_IDENTITY_STATUS_ID);
		if (existing) {
			existing.textContent = text;
			existing.dataset.refarmHeraldIdentityStatus = this.identityStatus;
			return;
		}

		const health = document.getElementById("system-health");
		if (health) {
			health.textContent = text;
			health.dataset.refarmHeraldIdentityStatus = this.identityStatus;
			return;
		}

		const statusbar = document.getElementById("refarm-slot-statusbar");
		if (!statusbar) return;

		const element = document.createElement("span");
		element.id = HERALD_IDENTITY_STATUS_ID;
		element.dataset.refarmHeraldIdentityStatus = this.identityStatus;
		element.textContent = text;
		statusbar.appendChild(element);
	}

	public monitorLifecycle() {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.addEventListener("controllerchange", () => {
				// High-level intent: The system is ready to switch to the new version
				this.tractor.emitTelemetry({
					event: "system:update_ready",
					payload: { message: this.l8n.t("core/update_ready_message") },
				});
			});

			navigator.serviceWorker.ready.then((reg) => {
				reg.addEventListener("updatefound", () => {
					const newWorker = reg.installing;
					if (newWorker) {
						newWorker.addEventListener("statechange", () => {
							if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
								// Background download complete
								this.tractor.emitTelemetry({
									event: "system:update_available",
									payload: { version: "pending" },
								});
							}
						});
					}
				});
			});
		}
	}

	public announce() {
		const primary = "color: #2e7d32; font-weight: bold; font-size: 1.2rem;";
		const accent = "color: #ff9800; font-weight: bold;";
		const muted = "color: #757575;";

		console.log(
			`%c\n` +
				`  ██████╗ ███████╗███████╗ █████╗ ██████╗ ███╗   ███╗\n` +
				`  ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗████╗ ████║\n` +
				`  ██████╔╝█████╗  █████╗  ███████║██████╔╝██╔████╔██║\n` +
				`  ██╔══██╗██╔══╝  ██╔══╝  ██╔══██║██╔══██╗██║╚██╔╝██║\n` +
				`  ██║  ██║███████╗██║     ██║  ██║██║  ██║██║ ╚═╝ ██║\n` +
				`  ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝\n` +
				`%c\n` +
				`  ${this.l8n.t("core/engine_version", { version: HOMESTEAD_ENGINE_VERSION })}\n` +
				`  ${this.l8n.t("core/knowledge_workspace")}\n\n`,
			primary,
			muted,
		);

		console.group(`%c${this.l8n.t("core/loaded_capabilities")}`, accent);
		if (this._logs.length === 0) {
			console.log(`%c  ${this.l8n.t("core/no_external_plugins_loaded")}`, muted);
		} else {
			this._logs.forEach((l) => console.log(l));
		}
		console.groupEnd();
		console.log("\n");
	}
}
