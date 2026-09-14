import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveRuntimeLaunchCommand } from "./launcher.js";

/**
 * MEASURED 2026-08-19, after this node was moved off the development working tree and onto an
 * INSTALLED copy. `refarm runtime ensure` answered `ensured: false, started: false, ok: false`,
 * and the reason was not that the fallback was unreachable — it was that the fallback was WRONG.
 *
 * The node's real runtime runs as:
 *
 *   tractor --plugin …/refarm_agent/plugin.wasm --plugin …/refarm_lsp-code-ops/plugin.wasm \
 *           --refarm-dir ~/.refarm
 *
 * and the PATH branch launched a bare `tractor` with `binaryArgs: []` — no plugins, no sovereign
 * directory. A node started that way is not the operator's node; it is a different one wearing the
 * same name, which is worse than refusing to start.
 *
 * Those arguments are NODE facts — the declared plugins and the home — so the launcher takes them
 * rather than deriving them, and the layer that knows the node supplies them. ADR-059 already put
 * plugin discovery in the CLI; this keeps it there.
 */
let repo: string;
beforeEach(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-launcher-"));
});
afterEach(() => {
	fs.rmSync(repo, { recursive: true, force: true });
});

describe("resolveRuntimeLaunchCommand", () => {
	it("prefers the repo script when one is present, unchanged", () => {
		fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
		fs.writeFileSync(path.join(repo, "scripts", "tractor-start.sh"), "#!/bin/sh\n");
		const command = resolveRuntimeLaunchCommand(repo, "rust");
		expect(command.source).toBe("repo-script");
		expect(command.command).toBe("bash");
	});

	it("carries the NODE's arguments into the PATH fallback", () => {
		// The whole fix. Without these the fallback starts a runtime with no plugins and no
		// sovereign directory — a different node, silently.
		const command = resolveRuntimeLaunchCommand(repo, "rust", [
			"--plugin",
			"/home/op/.refarm/plugins/refarm_agent/plugin.wasm",
			"--refarm-dir",
			"/home/op/.refarm",
		]);
		expect(command.source).toBe("path");
		expect(command.command).toBe("tractor");
		expect(command.args).toEqual([
			"--plugin",
			"/home/op/.refarm/plugins/refarm_agent/plugin.wasm",
			"--refarm-dir",
			"/home/op/.refarm",
		]);
		expect(command.display).toContain("--refarm-dir");
	});

	it("APPENDS to the starter's own arguments rather than replacing them", () => {
		// `--background` is how the ts engine daemonises. Node arguments say WHICH node, never HOW
		// to run one — substituting them produced `farmhand --refarm-dir …` with no `--background`.
		const command = resolveRuntimeLaunchCommand(repo, "ts", ["--refarm-dir", "/home/op/.refarm"]);
		expect(command.args).toEqual(["--background", "--refarm-dir", "/home/op/.refarm"]);
	});

	it("keeps the old bare invocation when a caller supplies nothing", () => {
		// Adopting this must not change a caller that never learned to pass node arguments.
		const command = resolveRuntimeLaunchCommand(repo, "rust");
		expect(command.source).toBe("path");
		expect(command.args).toEqual([]);
	});

	it("does not let node arguments override the repo script's own", () => {
		// The script derives its own arguments and takes trailing ones; handing it a second,
		// independently-derived set is how two sources of truth start disagreeing.
		fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
		fs.writeFileSync(path.join(repo, "scripts", "tractor-start.sh"), "#!/bin/sh\n");
		const command = resolveRuntimeLaunchCommand(repo, "rust", ["--refarm-dir", "/x"]);
		expect(command.args).toEqual([path.join(repo, "scripts", "tractor-start.sh"), "--background"]);
	});
});
