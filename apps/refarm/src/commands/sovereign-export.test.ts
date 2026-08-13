import { describe, expect, it } from "vitest";

import {
	formatExportPlan,
	planEntry,
	planSovereignExport,
	reAuthenticateCommand,
	splitSiloContent,
} from "./sovereign-export.js";
import type { InventoryEntry } from "./sovereign-inventory.js";

const entry = (overrides: Partial<InventoryEntry> & { file: string }): InventoryEntry => ({
	bytes: 1024,
	recoverability: "irrecoverable",
	source: "none",
	reason: "",
	declared: true,
	...overrides,
});

/**
 * The one thing a backup must never do is look complete while missing something, and the two ways
 * it can do that are opposite: carrying a secret it should not, and dropping a decision it should
 * have kept. The silo is both cases in one file.
 */
describe("splitSiloContent", () => {
	const TOKENS = {
		modelProvider: "openai-codex",
		modelId: "gpt-5.5",
		modelBaseUrl: "https://example.invalid",
		modelRoutes: { worker: "openai-codex/gpt-5.5" },
		oauthProvider: "openai-codex",
		oauthCredentials: { "openai-codex": { access: "SECRET-TOKEN", expires: 1 } },
		modelApiKey: "sk-SECRET",
		githubToken: "gho_SECRET",
		githubOwner: "arthur",
	};

	it("carries the decisions, which no login rebuilds", () => {
		const { decisions } = splitSiloContent(TOKENS);
		expect(decisions).toMatchObject({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			modelRoutes: { worker: "openai-codex/gpt-5.5" },
			githubOwner: "arthur",
		});
	});

	it("carries NO secret, checked by searching the whole serialised result", () => {
		// Asserted by absence of the values rather than by absence of the keys: a key renamed or
		// nested would slip past a key-name assertion, and the thing that matters is whether the
		// bytes leave the machine.
		const serialised = JSON.stringify(splitSiloContent(TOKENS).decisions);
		expect(serialised).not.toContain("SECRET-TOKEN");
		expect(serialised).not.toContain("sk-SECRET");
		expect(serialised).not.toContain("gho_SECRET");
	});

	it("is an ALLOWLIST, so a newly added secret does not travel by default", () => {
		// The load-bearing default. With a denylist, a key someone adds to the silo next month
		// travels until somebody remembers to exclude it. Here it simply does not travel.
		const { decisions } = splitSiloContent({ ...TOKENS, someFutureApiSecret: "LEAK" });
		expect(JSON.stringify(decisions)).not.toContain("LEAK");
	});

	it("names every credential to re-obtain, across all three kinds", () => {
		// OAuth entry, API key, and the runtime tokens — each is a login the operator will need to
		// redo, and a backup that did not list them would restore a node that silently cannot work.
		expect(splitSiloContent(TOKENS).reAuthenticate).toEqual(["github", "openai-codex"]);
	});

	it("reports no credentials for an empty silo rather than inventing one", () => {
		expect(splitSiloContent({})).toEqual({ decisions: {}, reAuthenticate: [] });
	});
});

describe("planEntry", () => {
	it("never carries the silo, and says where its decisions went", () => {
		const planned = planEntry(entry({ file: "/home/op/.silo/identity.json" }));
		expect(planned.disposition).toBe("re-authenticate");
		expect(planned.reason).toContain("safe to move");
	});

	it("carries a declared irrecoverable file", () => {
		expect(planEntry(entry({ file: "/home/op/.refarm/config.json" })).disposition).toBe("carry");
	});

	it("skips what rebuilds itself, naming the source", () => {
		const planned = planEntry(
			entry({ file: "/home/op/.refarm/model-rates.v1.json", recoverability: "recoverable", source: "rebuild" }),
		);
		expect(planned).toMatchObject({ disposition: "skip", reason: "rebuilt from rebuild" });
	});

	it("leaves the unclassified UNDECIDED — neither carried nor dismissed", () => {
		// 84 of these on the operator's node. Carrying them all buries the files that stand the node
		// up; dropping them all could discard data. Either default would be a decision made for him.
		const planned = planEntry(
			entry({ file: "/home/op/.refarm/mystery.json", recoverability: "unknown", reason: "no rule" }),
		);
		expect(planned.disposition).toBe("undecidable");
		expect(planned.reason).toContain("decide before trusting this backup");
	});

	it("calls an undeclared irrecoverable file FOREIGN — decided, not a loose end", () => {
		// The operator's policy, 2026-08-13. Before it, these 71 files sat permanently "undecided"
		// and the bundle reported itself incomplete forever, which turns the warning into noise.
		// Foreign is an answer: not the node's, not carried, not deleted.
		expect(planEntry(entry({ file: "/home/op/x/repro.db", declared: false })).disposition).toBe(
			"foreign",
		);
	});

	it("leaves UNDECIDABLE for what the layout does not describe, and nothing else", () => {
		// The distinction that keeps the completeness signal meaningful: `foreign` is decided,
		// `undecidable` means a subsystem writes somewhere the layout never described — the state
		// that would have caught the CA key years earlier.
		const unregistered = planEntry(
			entry({ file: "/home/op/.refarm/new-thing/x", recoverability: "unknown", declared: false }),
		);
		expect(unregistered.disposition).toBe("undecidable");
	});
});

describe("planSovereignExport", () => {
	const PLAN = planSovereignExport([
		entry({ file: "/n/.refarm/config.json", bytes: 4096 }),
		entry({ file: "/n/.refarm/node-id", bytes: 37 }),
		entry({ file: "/n/.silo/identity.json" }),
		entry({ file: "/n/.refarm/rates.json", recoverability: "recoverable", source: "rebuild" }),
		entry({ file: "/n/x/repro.db", declared: false }),
	]);

	it("counts each disposition and the bytes it will actually write", () => {
		expect(PLAN.carry.map((e) => e.file)).toEqual(["/n/.refarm/config.json", "/n/.refarm/node-id"]);
		expect(PLAN.carriedBytes).toBe(4133);
		expect(PLAN.skip).toHaveLength(1);
		expect(PLAN.foreign).toHaveLength(1);
		expect(PLAN.undecidable).toHaveLength(0);
	});

	it("is COMPLETE when nothing is unregistered, even with foreign files present", () => {
		// The payoff of the policy: a node full of scratch can still have a complete backup, because
		// the scratch has an answer. Measured on the operator's node the same day: 153 undecided
		// became 0, with 71 foreign and 69 rebuilt.
		const withForeign = planSovereignExport([
			entry({ file: "/n/.refarm/config.json" }),
			entry({ file: "/n/x/repro.db", declared: false }),
		]);
		expect(withForeign.foreign).toHaveLength(1);
		expect(withForeign.hasUndecided).toBe(false);
	});

	it("flags that the backup is not complete while anything is undecided", () => {
		// The signal that stops a false sense of safety. A plan with undecided entries has not yet
		// been turned into a backup anyone should trust.
		expect(
			planSovereignExport([
				entry({ file: "/n/?", recoverability: "unknown", declared: false }),
			]).hasUndecided,
		).toBe(true);
		expect(planSovereignExport([entry({ file: "/n/.refarm/config.json" })]).hasUndecided).toBe(false);
	});

	it("treats an unmeasured file as unmeasured, not as empty", () => {
		// `bytes: null` means the inventory could not stat it. Adding it as 0 would understate the
		// bundle and, worse, read as "this file is empty".
		expect(planSovereignExport([entry({ file: "/n/a", bytes: null })]).carriedBytes).toBe(0);
		expect(planSovereignExport([entry({ file: "/n/a", bytes: null })]).carry[0]?.bytes).toBeNull();
	});
});

describe("reAuthenticateCommand", () => {
	it("keeps the two provider axes apart", () => {
		// The module that split the axes must not then print `--model-provider github`, which is a
		// command that fails.
		expect(reAuthenticateCommand("github")).toBe("refarm sow --github");
		expect(reAuthenticateCommand("cloudflare")).toBe("refarm sow --cloudflare");
		expect(reAuthenticateCommand("openai-codex")).toBe("refarm sow --model-provider openai-codex");
	});
});

describe("formatExportPlan", () => {
	it("leads with what the bundle will NOT contain", () => {
		const plan = planSovereignExport([entry({ file: "/n/.refarm/config.json" })]);
		const text = formatExportPlan(plan, ["openai-codex", "github"]);
		expect(text).toContain("DOES NOT CARRY SECRETS");
		expect(text).toContain("refarm sow --model-provider openai-codex");
		expect(text).toContain("refarm sow --github");
	});

	it("says a node with no credentials has none, rather than printing an empty list", () => {
		const text = formatExportPlan(planSovereignExport([]), []);
		expect(text).toContain("no stored credentials found");
	});
});
