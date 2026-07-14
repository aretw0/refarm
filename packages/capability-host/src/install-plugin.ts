import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Materialize an installable plugin dir from a template manifest + a wasm — the minimal
 * form the native runtime loads (`plugin.wasm` + a `plugin.json` carrying `entry` and
 * `integrity`). This is the install step the farmhand does at boot, extracted so a test
 * or a self-contained demo can load a template-only plugin (e.g. @refarm/agent, whose
 * dist/plugin.json omits entry/integrity by design) via `--plugin` without running the
 * farmhand. The returned wasm path is what you pass to startRuntimeDaemon's `plugins`.
 */

export interface InstallPluginOptions {
	/** Path to the built .wasm component. */
	wasmPath: string;
	/** Path to the template plugin.json (id/capabilities/permissions/…, no entry). */
	manifestTemplatePath: string;
	/** Directory to install into (created if missing). Its `plugin.wasm` + `plugin.json`
	 * are what the runtime loads. */
	installDir: string;
	/** Shallow manifest field overrides, merged OVER the template (after entry/integrity are
	 * injected). Lets a demo install the SAME wasm under a tightened manifest — e.g. drop a
	 * permission to show the host DENY the effect under strict mode. A field set here replaces
	 * the template's (no deep merge), so pass the full desired value (e.g. the whole
	 * `permissions` array). */
	manifestOverrides?: Record<string, unknown>;
}

export interface InstalledPlugin {
	/** The installed wasm path — pass this to startRuntimeDaemon({ plugins }). */
	wasmPath: string;
	/** The installed plugin.json path. */
	manifestPath: string;
	/** The sha256-… integrity of the wasm bytes. */
	integrity: string;
}

/**
 * Copy the wasm and write a manifest with `entry` + `integrity` injected — the same
 * shape farmhand's bundleInstallPlugin produces. Idempotent per installDir.
 */
export function installPluginForRuntime(options: InstallPluginOptions): InstalledPlugin {
	mkdirSync(options.installDir, { recursive: true });

	const wasmDest = join(options.installDir, "plugin.wasm");
	copyFileSync(options.wasmPath, wasmDest);

	const wasmBytes = readFileSync(wasmDest);
	const integrity = `sha256-${createHash("sha256").update(wasmBytes).digest("hex")}`;

	const template = JSON.parse(readFileSync(options.manifestTemplatePath, "utf-8")) as Record<
		string,
		unknown
	>;
	const manifest = {
		...template,
		// The runtime resolves entry relative to the manifest dir; a bare filename keeps
		// the install dir relocatable.
		entry: "./plugin.wasm",
		integrity,
		// A demo may tighten the manifest (e.g. drop a permission) — overrides win over the
		// template (but never over entry/integrity, which are structural).
		...(options.manifestOverrides ?? {}),
	};

	const manifestPath = join(options.installDir, "plugin.json");
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

	return { wasmPath: wasmDest, manifestPath, integrity };
}
