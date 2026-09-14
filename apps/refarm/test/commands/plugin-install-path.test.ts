/**
 * ONE INSTALLER, ONE PATH.
 *
 * Measured defect (2026-08-05, operator's own node): the agent plugin had TWO installers
 * writing TWO directories — `refarm plugin install` wrote
 * `$REFARM_HOME/plugins/refarm_agent/` (the `pluginIdToFsToken` layout `.versions` already
 * keys on), while `scripts/agent-install.mjs`, invoked by `scripts/tractor-start.sh`, wrote
 * `$REFARM_HOME/plugins/@refarm/agent/`, and the start script hardcoded THAT as the path it
 * loaded. After a rebuild, `refarm plugin install --bundled` answered "cached | already
 * up-to-date" — true of ITS directory — while the daemon kept loading a stale wasm from the
 * other one. The recovery handoff printed when `refarm ask` failed was
 * `refarm plugin install --json`: a command that could not fix the problem, because it wrote
 * where nothing loaded.
 *
 * These are the pins that make that unrepresentable. A comment saying "keep these equal"
 * would be worth nothing; each test below fails if the two ever drift again.
 */
import { RUNTIME_AGENT_PLUGIN_DESCRIPTOR } from "@refarm.dev/config/plugin-identity";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@refarm.dev/barn", () => ({
	resolvePluginPackage: vi.fn(),
}));

const { resolvePluginPackage } = await import("@refarm.dev/barn");
const { installPlugin } = await import("../../src/commands/plugin-install.js");
const { installedPluginDir, installedPluginWasmPath, legacyScopedPluginWasmPath } = await import(
	"../../src/commands/plugin-install-path.js"
);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const AGENT = RUNTIME_AGENT_PLUGIN_DESCRIPTOR;

let refarmHome: string;
let previousRefarmHome: string | undefined;

/** A minimal npm package on disk, shaped like what `resolvePluginPackage` resolves to. */
function makeAgentPackage(wasmBytes: string, version = "0.1.0"): string {
	const pkgDir = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-pkg-"));
	mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
	writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ version }));
	writeFileSync(path.join(pkgDir, AGENT.wasmFile), wasmBytes);
	writeFileSync(
		path.join(pkgDir, AGENT.manifestFile),
		JSON.stringify({
			id: AGENT.id,
			version,
			capabilities: { provides: AGENT.requiredProvides },
		}),
	);
	vi.mocked(resolvePluginPackage).mockReturnValue({ source: "workspace", pkgDir });
	return pkgDir;
}

/** Every `plugin.wasm` anywhere under the plugins dir — the drift detector. */
function installedWasmFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...installedWasmFiles(full));
		else if (entry.name === "plugin.wasm") found.push(full);
	}
	return found;
}

beforeEach(() => {
	previousRefarmHome = process.env.REFARM_HOME;
	refarmHome = mkdtempSync(path.join(os.tmpdir(), "refarm-home-install-path-"));
	process.env.REFARM_HOME = refarmHome;
});

afterEach(() => {
	if (previousRefarmHome === undefined) delete process.env.REFARM_HOME;
	else process.env.REFARM_HOME = previousRefarmHome;
	vi.restoreAllMocks();
});

describe("the path plugin install writes and the path the start script loads", () => {
	it("is ONE function — the installer writes exactly installedPluginWasmPath, and nowhere else", async () => {
		makeAgentPackage("wasm-bytes-v1");

		const result = await installPlugin(AGENT, false, { quiet: true });

		expect(result.status).toBe("installed");
		const loaded = installedPluginWasmPath(AGENT.id);
		expect(existsSync(loaded)).toBe(true);
		// The pin that matters: the ONLY artifact on this node is the one the resolver
		// names. A second installer writing a second directory shows up right here.
		expect(installedWasmFiles(path.join(refarmHome, "plugins"))).toEqual([loaded]);
	});

	it("uses the CLI's pluginIdToFsToken layout, not the scoped npm layout", () => {
		expect(installedPluginDir(AGENT.id)).toBe(path.join(refarmHome, "plugins", "refarm_agent"));
		expect(installedPluginWasmPath(AGENT.id)).not.toBe(legacyScopedPluginWasmPath(AGENT.id));
		// The sentinel `.versions` file already keyed on this projection before the
		// convergence — that mismatch was the tell.
		expect(path.basename(installedPluginDir(AGENT.id))).toBe("refarm_agent");
	});

	it("points the installed manifest's entry at the same one path", async () => {
		makeAgentPackage("wasm-bytes-v1");
		await installPlugin(AGENT, false, { quiet: true });

		const manifest = JSON.parse(
			readFileSync(path.join(installedPluginDir(AGENT.id), "plugin.json"), "utf-8"),
		) as { entry: string };
		expect(manifest.entry).toBe(`file://${installedPluginWasmPath(AGENT.id)}`);
	});

	it("REACHES the loaded path when the plugin is rebuilt at the SAME version — the case that failed", async () => {
		makeAgentPackage("wasm-bytes-v1", "0.1.0");
		await installPlugin(AGENT, false, { quiet: true });
		expect(readFileSync(installedPluginWasmPath(AGENT.id), "utf-8")).toBe("wasm-bytes-v1");

		// Same version, different bytes: exactly a `cargo component build` that changed the
		// artifact without bumping package.json. The currency check compares the manifest
		// integrity against the freshly hashed source, so it must reinstall, not report cached
		// — and it must land on the path the daemon actually loads.
		makeAgentPackage("wasm-bytes-v2-rebuilt", "0.1.0");
		const rebuilt = await installPlugin(AGENT, false, { quiet: true });

		expect(rebuilt.status).toBe("installed");
		expect(readFileSync(installedPluginWasmPath(AGENT.id), "utf-8")).toBe("wasm-bytes-v2-rebuilt");
	});

	it("makes the ask recovery handoff able to fix the problem it is printed for", async () => {
		// When `refarm ask` failed because the plugin would not load, the handoff printed
		// `refarm plugin install --json` — a command that could not help, because it wrote
		// where nothing loaded. Same command today; the difference is that it now writes the
		// path the start script resolves. That is the whole repair, so it is pinned here.
		const { buildAskErrorPayload } = await import("../../src/commands/ask-errors.js");
		const payload = buildAskErrorPayload('plugin "@refarm/agent" is not loaded');
		expect(payload.nextCommand).toBe("refarm plugin install --json");

		makeAgentPackage("wasm-bytes-v1");
		await installPlugin(AGENT, false, { quiet: true });
		expect(installedWasmFiles(path.join(refarmHome, "plugins"))).toEqual([
			installedPluginWasmPath(AGENT.id),
		]);
	});

	it("reports cached only when the loaded path already holds those exact bytes", async () => {
		makeAgentPackage("wasm-bytes-v1", "0.1.0");
		await installPlugin(AGENT, false, { quiet: true });

		const again = await installPlugin(AGENT, false, { quiet: true });
		expect(again.status).toBe("cached");
		expect(readFileSync(installedPluginWasmPath(AGENT.id), "utf-8")).toBe("wasm-bytes-v1");
	});
});

describe("tractor-start.sh loads what the installer wrote", () => {
	const startScript = readFileSync(path.join(REPO_ROOT, "scripts/tractor-start.sh"), "utf-8");
	const bridge = readFileSync(path.join(REPO_ROOT, "scripts/installed-plugin-path.mjs"), "utf-8");

	it("asks the bridge for the canonical path instead of spelling a layout of its own", () => {
		expect(startScript).toMatch(/scripts\/installed-plugin-path\.mjs/);
		expect(startScript).toMatch(/INSTALLED_AGENT_PLUGIN="\$\(/);
	});

	it("names the scoped layout ONLY as the read-only legacy fallback", () => {
		const scopedMentions = [...startScript.matchAll(/plugins\/@refarm\/agent/g)];
		// One assignment (LEGACY_AGENT_PLUGIN) plus prose. What must never come back is a
		// canonical/loaded path spelled here — that is what the assignment name encodes.
		expect(scopedMentions.length).toBeGreaterThan(0);
		expect(startScript).toMatch(
			/LEGACY_AGENT_PLUGIN="\$REFARM_HOME\/plugins\/@refarm\/agent\/plugin\.wasm"/,
		);
		expect(startScript).not.toMatch(
			/INSTALLED_AGENT_PLUGIN="\$REFARM_HOME\/plugins\/@refarm\/agent\/plugin\.wasm"/,
		);
	});

	it("has no second installer: the deleted agent-install.mjs is never invoked again", () => {
		expect(existsSync(path.join(REPO_ROOT, "scripts/agent-install.mjs"))).toBe(false);
		expect(startScript).not.toMatch(/node .*scripts\/agent-install\.mjs/);
	});

	it("bridges to the compiled single path function, never a re-implementation", () => {
		expect(bridge).toMatch(/plugin-install-path\.js/);
		expect(bridge).toMatch(/installedPluginWasmPath/);
		// A re-implementation of the flatten inside the bridge would defeat the point.
		expect(bridge).not.toMatch(/replace\(/);
	});
});

describe("resolve_installed_agent_plugin (scripts/agent-plugin-path.sh)", () => {
	const helper = path.join(REPO_ROOT, "scripts/agent-plugin-path.sh");

	/** The path the helper prints on stdout — what the start script captures. */
	function resolve(canonical: string, legacy: string): string {
		return execFileSync(
			"bash",
			["-c", `. '${helper}'; resolve_installed_agent_plugin "$1" "$2"`, "resolve", canonical, legacy],
			{ encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
		);
	}

	/** What the HUMAN sees: notices go to stderr so $(...) capture leaves them visible. */
	function resolveNotice(canonical: string, legacy: string): string {
		return execFileSync(
			"bash",
			[
				"-c",
				// `2>&1 >/dev/null` (in this order) sends stderr to the pipe and drops stdout.
				`. '${helper}'; resolve_installed_agent_plugin "$1" "$2" 2>&1 >/dev/null`,
				"resolve",
				canonical,
				legacy,
			],
			{ encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
		);
	}

	let home: string;
	let canonical: string;
	let legacy: string;

	beforeEach(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "refarm-agent-resolve-"));
		canonical = path.join(home, "plugins/refarm_agent/plugin.wasm");
		legacy = path.join(home, "plugins/@refarm/agent/plugin.wasm");
	});

	function install(target: string): void {
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, "wasm");
	}

	it("loads the canonical install when it is there", () => {
		install(canonical);
		expect(resolve(canonical, legacy)).toBe(canonical);
	});

	it("STILL BOOTS a node that only has the legacy scoped directory — the migration case", () => {
		install(legacy);
		expect(resolve(canonical, legacy)).toBe(legacy);
	});

	it("says so out loud when it falls back to the legacy directory, never silently", () => {
		install(legacy);
		const notice = resolveNotice(canonical, legacy);
		expect(notice).toContain("LEGACY");
		expect(notice).toContain(legacy);
		expect(notice).toContain("refarm plugin install --bundled");
	});

	it("prefers the canonical one when BOTH exist, and names the one it is not loading", () => {
		install(canonical);
		install(legacy);
		expect(resolve(canonical, legacy)).toBe(canonical);

		const notice = resolveNotice(canonical, legacy);
		expect(notice).toContain(path.dirname(legacy));
		expect(notice).toContain("NOT being loaded");
		expect(notice).toContain(canonical);
	});

	it("answers nothing when neither is installed, so the caller keeps the compiled build", () => {
		expect(resolve(canonical, legacy)).toBe("");
	});

	it("passes bash -n", () => {
		execFileSync("bash", ["-n", helper], { stdio: "pipe" });
	});
});
