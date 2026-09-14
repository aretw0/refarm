import {
	OPERATION_AUTHORIZE,
	OPERATION_DECLINE,
} from "@refarm.dev/operation-consent-v1";
import {
	createScriptedOperatorChannel,
	setPromptPublisher,
} from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runToolsAdd, runToolsList } from "./tools.js";

/**
 * The wizard half of `nodeTools`. What these tests defend is the ORDER of the journey: measure,
 * then propose, then show, then ask, then write. A wizard that writes before the yes, or proposes
 * a floor it never measured, is the failure this file exists to prevent.
 */

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-tools-"));
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const configPath = () => path.join(root, ".refarm", "config.json");
const readConfig = () => JSON.parse(fs.readFileSync(configPath(), "utf-8"));

/** A spawn that answers for exactly one binary and refuses every other, so a test can never
 *  accidentally measure the machine it runs on. */
function fakeSpawn(banners: Record<string, string>) {
	return ((command: string) => {
		const banner = banners[command];
		if (banner === undefined) return { status: 1, stdout: "", stderr: "not found", error: undefined };
		return { status: 0, stdout: banner, stderr: "", error: undefined };
	}) as never;
}

const GH = fakeSpawn({ gh: "gh version 2.4.0 (2022-03-30)" });
const quiet = () => {};

describe("runToolsAdd", () => {
	it("REFUSES a tool that is not installed, rather than declaring it by accident", async () => {
		const result = await runToolsAdd("nope", {}, { root, spawnSync: GH, operator: null, review: quiet });
		expect(result.status).toBe("refused");
		expect(fs.existsSync(configPath())).toBe(false);
	});

	it("declares an absent tool when the operator says they are about to install it", async () => {
		const operator = createScriptedOperatorChannel(["1.0.0", "the VPN client", OPERATION_AUTHORIZE]);
		const result = await runToolsAdd(
			"ovpnctl",
			{ evenIfAbsent: true },
			{ root, spawnSync: GH, operator, review: quiet },
		);
		expect(result.status).toBe("authorized");
		expect(readConfig().nodeTools.ovpnctl).toEqual({ minVersion: "1.0.0", why: "the VPN client" });
	});

	it("writes NOTHING when there is nobody to ask", async () => {
		// A consent-gated write with no operator is not a silent write. It is no write.
		const result = await runToolsAdd(
			"gh",
			{ minVersion: "2.40.0", why: "CI" },
			{ root, spawnSync: GH, operator: null, review: quiet },
		);
		expect(result.status).toBe("deferred");
		expect(fs.existsSync(configPath())).toBe(false);
	});

	it("writes NOTHING when the operator declines", async () => {
		const operator = createScriptedOperatorChannel([OPERATION_DECLINE]);
		const result = await runToolsAdd(
			"gh",
			{ minVersion: "2.40.0", why: "CI" },
			{ root, spawnSync: GH, operator, review: quiet },
		);
		expect(result.status).toBe("declined");
		expect(fs.existsSync(configPath())).toBe(false);
	});

	it("proposes the MEASURED version as the floor the operator merely confirms", async () => {
		// Empty answer ⇒ the prompt's default ⇒ what was measured. This is the line between a
		// draft the operator accepts and an inference nobody decided.
		const operator = createScriptedOperatorChannel(["2.4.0", "CI handoffs", OPERATION_AUTHORIZE]);
		const result = await runToolsAdd("gh", {}, { root, spawnSync: GH, operator, review: quiet });
		expect(result.status).toBe("authorized");
		expect(readConfig().nodeTools.gh.minVersion).toBe("2.4.0");
		expect(operator.notices().some((n) => n.message.includes("2.4.0"))).toBe(true);
	});

	it("tells the operator that authorising this ALSO authorises an execution", async () => {
		// The surprising half of the declaration: `health` will run the binary on every audit.
		// Burying that in docs and not in the consent notes would be consent to the wrong thing.
		const lines: string[] = [];
		const operator = createScriptedOperatorChannel(["2.4.0", "CI", OPERATION_AUTHORIZE]);
		await runToolsAdd("gh", {}, { root, spawnSync: GH, operator, review: (l) => lines.push(l) });
		expect(lines.join("\n")).toMatch(/runs `gh --version`/u);
	});

	it("keeps a key this build does not know about when re-declaring", async () => {
		// ISS-036's lesson: a writer replaces what it OWNS. An operator who hand-added a field
		// must not lose it to a wizard that only came to change the floor.
		fs.mkdirSync(path.dirname(configPath()), { recursive: true });
		fs.writeFileSync(
			configPath(),
			JSON.stringify({ nodeTools: { gh: { minVersion: "1.0.0", note: "mine" } } }, null, 2),
		);
		const operator = createScriptedOperatorChannel(["2.40.0", "CI", OPERATION_AUTHORIZE]);
		await runToolsAdd("gh", {}, { root, spawnSync: GH, operator, review: quiet });
		expect(readConfig().nodeTools.gh).toEqual({ minVersion: "2.40.0", why: "CI", note: "mine" });
	});
});

describe("runToolsList", () => {
	it("shows a satisfied tool too, because 'nothing wrong' is not 'nothing declared'", () => {
		const result = runToolsList({
			env: { HOME: root, SOVEREIGN_DIR: ".refarm" } as NodeJS.ProcessEnv,
			spawnSync: GH,
			readConfig: () => ({ nodeTools: { gh: { minVersion: "2.0.0", why: "CI" } } }),
		});
		expect(result.tools).toEqual([
			{
				command: "gh",
				state: "ok",
				minVersion: "2.0.0",
				measuredVersion: "2.4.0",
				why: "CI",
				detail: null,
			},
		]);
	});

	it("reports the same four states the auditor does, from the same decision", () => {
		const result = runToolsList({
			env: { HOME: root, SOVEREIGN_DIR: ".refarm" } as NodeJS.ProcessEnv,
			spawnSync: GH,
			readConfig: () => ({
				nodeTools: { gh: { minVersion: "2.40.0" }, nope: {}, bad: "3.2.7" },
			}),
		});
		expect(result.tools.map((t) => [t.command, t.state])).toEqual([
			["gh", "outdated"],
			["nope", "absent"],
		]);
		expect(result.malformed).toHaveLength(1);
	});
});

describe("runToolsAdd — attended elsewhere", () => {
	/**
	 * The half that makes this a wizard and not a terminal script.
	 *
	 * `--attended-elsewhere` must select the ATTENDED channel, which routes the question through
	 * whatever publisher the node has installed — the sidecar prompt hub in a real run, this fake
	 * here. Proven live on 2026-08-18 against the node at 127.0.0.1:42001: the consent select
	 * appeared in `GET /prompts` with all three options, an external HTTP client answered
	 * `authorize`, and the declaration was written without the terminal being used. This test is
	 * the repeatable half of that, so the wiring cannot rot between live runs.
	 */
	it("routes the question to the PUBLISHER and writes from an answer that never touched a terminal", async () => {
		const asked: unknown[] = [];
		const announced: string[] = [];
		const restore = setPromptPublisher(() => ({
			remote: () => ({
				// `lastSettlement` is part of the contract — which device ended the ask. This fake
				// never races, so nothing settled it but the answer itself.
				lastSettlement: () => null,
				ask: (async (prompt: unknown) => {
					asked.push(prompt);
					// Whatever an attending device would send back: the two texts, then the consent.
					return asked.length === 1
						? "2.40.0"
						: asked.length === 2
							? "CI handoffs"
							: OPERATION_AUTHORIZE;
				}) as never,
			}),
			announce: (notice) =>
				announced.push(typeof notice === "string" ? notice : notice.message),
		}));
		try {
			const result = await runToolsAdd(
				"gh",
				{ attendedElsewhere: true },
				// NO injected operator: the channel must be chosen by the flag, which is the wiring
				// under test. Injecting one here would prove only that the injection works.
				{ root, spawnSync: GH, review: quiet },
			);
			expect(result.status).toBe("authorized");
			expect(readConfig().nodeTools.gh).toEqual({ minVersion: "2.40.0", why: "CI handoffs" });
		} finally {
			restore();
		}

		// The measurement travelled too. A device asked to authorise a floor it was never shown
		// is being asked to trust the asker, which is the opposite of what consent is for.
		expect(announced.join("\n")).toContain("2.4.0");
		// Three questions reached the elsewhere: the floor, the reason, and the consent itself.
		expect(asked).toHaveLength(3);
		expect((asked[2] as { type: string }).type).toBe("select");
	});

	it("writes nothing when there is no publisher to reach — attending elsewhere is not a promise", async () => {
		// `createAttendedOperatorChannel` returns null with no publisher installed. That must be
		// the same "nobody to ask" outcome as a headless terminal: deferred, nothing written.
		const result = await runToolsAdd(
			"gh",
			{ attendedElsewhere: true, minVersion: "2.40.0", why: "CI" },
			{ root, spawnSync: GH, review: quiet },
		);
		expect(result.status).toBe("deferred");
		expect(fs.existsSync(configPath())).toBe(false);
	});
});
