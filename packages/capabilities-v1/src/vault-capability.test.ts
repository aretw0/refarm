import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/cli/capabilities";
import {
	parseRecordsYamlLdFrontMatter,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	createLocalVaultCommandDeps,
	createVaultCapabilityGroup,
	type VaultCommandDeps,
} from "./vault-capability.js";
import type { VaultDiscoveryResult } from "./vault-discovery-types.js";

function discoverWithExtractor(): VaultDiscoveryResult {
	return {
		providers: [
			{
				pluginId: "@demo/vault-extract",
				pluginKey: "vault",
				verbs: ["search", "extract"],
				targets: ["vault:search", "vault:extract"],
			},
		],
		rejected: [],
	};
}

/** Captures the submitted effort so a dispatch test can assert on it. */
function makeDeps(
	discover: () => VaultDiscoveryResult = discoverWithExtractor,
): VaultCommandDeps & { submitted: import("@refarm.dev/effort-contract-v1").Effort[] } {
	const submitted: import("@refarm.dev/effort-contract-v1").Effort[] = [];
	let counter = 0;
	return {
		discover,
		submitEffort: async (effort) => {
			submitted.push(effort);
			return effort.id;
		},
		newId: () => `id-${++counter}`,
		submitted,
	};
}

function deps(
	discover: () => VaultDiscoveryResult = discoverWithExtractor,
): VaultCommandDeps {
	return makeDeps(discover);
}

describe("vault CapabilityGroup", () => {
	it("creates local/headless vault deps with no providers and optional seed", async () => {
		const localManifest = {
			manifestVersion: 1,
			records: [
				{
					id: "record:local",
					schemaVersion: 1,
					"@type": ["KnowledgeRecord"],
					"@context": "https://refarm.dev/contexts/records/v1",
					fields: { title: "Local" },
					contentHash: "hash",
				},
			],
		} satisfies RecordsManifest;
		const localDeps = createLocalVaultCommandDeps({
			seed: () => localManifest,
		});
		const group = createVaultCapabilityGroup(localDeps);
		const list = resolveGroupAction(group, ["list"]);
		const listed = await list!.action.run(list!.input) as unknown as {
			ok: boolean;
			count: number;
			providers: unknown[];
			rejected: unknown[];
		};
		expect(listed).toMatchObject({
			ok: true,
			count: 0,
			providers: [],
			rejected: [],
		});

		const effortId = await localDeps.submitEffort({
			id: "effort:local",
			direction: "dispatch",
			tasks: [],
			source: "test",
			submittedAt: "2026-07-08T00:00:00.000Z",
		});
		expect(effortId).toBe("effort:local");
		expect(localDeps.seed?.().records[0]?.id).toBe("record:local");
	});

	it("projects onto every surface bucket (REPL alias, HTTP route, TUI section)", () => {
		const group = createVaultCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual([
			"dispatch",
			"init",
			"list",
			"show",
		]);
		expect(group.defaultAction).toBe("list");
		expect(group.transports?.repl?.slashAliases).toContain("vaults");
		expect(group.transports?.http).toEqual({ method: "GET", path: "/vault" });
		expect(group.renderers?.tui?.section).toBe("extensions");
	});

	it("`list` surfaces a plugin-contributed vault provider with its verbs", async () => {
		const group = createVaultCapabilityGroup(deps());
		const resolved = resolveGroupAction(group, ["list"]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			count: number;
			providers: { pluginId: string; pluginKey: string; verbs: string[] }[];
		};
		expect(env.count).toBe(1);
		expect(env.providers[0]).toMatchObject({
			pluginId: "@demo/vault-extract",
			pluginKey: "vault",
			verbs: ["search", "extract"],
		});
	});

	it("`show <id>` resolves the provider's verbs+targets; unknown → error envelope", async () => {
		const group = createVaultCapabilityGroup(deps());

		const ok = resolveGroupAction(group, ["show", "@demo/vault-extract"]);
		const found = (await ok!.action.run(ok!.input)) as unknown as {
			ok: boolean;
			provider?: { pluginId: string; verbs: string[]; targets: string[] };
		};
		expect(found.ok).toBe(true);
		expect(found.provider?.pluginId).toBe("@demo/vault-extract");
		expect(found.provider?.targets).toEqual(["vault:search", "vault:extract"]);

		const missing = resolveGroupAction(group, ["show", "nope"]);
		const err = await missing!.action.run(missing!.input);
		expect(err.ok).toBe(false);
		expect((err as { error?: string }).error).toBe("vault-provider-not-found");
	});

	it("surfaces a rejected (unreadable) plugin without crashing the list", async () => {
		const group = createVaultCapabilityGroup(
			deps(() => ({ providers: [], rejected: ["@bad/plugin"] })),
		);
		const resolved = resolveGroupAction(group, ["list"]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			count: number;
			rejected: string[];
		};
		expect(env.ok).toBe(true);
		expect(env.count).toBe(0);
		expect(env.rejected).toEqual(["@bad/plugin"]);
	});

	it("`dispatch <verb> <note>` submits an effort whose fn is the verb + replyRef", async () => {
		const d = makeDeps();
		const group = createVaultCapabilityGroup(d);
		const resolved = resolveGroupAction(group, [
			"dispatch",
			"extract",
			"20-Projects/note-42.md",
		]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			effortId: string;
			verb: string;
			pluginId: string;
			replyRef: string;
		};
		expect(env.ok).toBe(true);
		expect(env.verb).toBe("extract");
		expect(env.pluginId).toBe("vault");
		// The submitted effort's task carries fn=verb and the replyRef for the
		// async dispatch-result correlation.
		expect(d.submitted).toHaveLength(1);
		const task = d.submitted[0]!.tasks[0]!;
		expect(task.pluginId).toBe("vault");
		expect(task.fn).toBe("extract");
		expect((task.args as { replyRef: string }).replyRef).toBe(env.effortId);
		expect((task.args as { note: { path: string } }).note.path).toBe(
			"20-Projects/note-42.md",
		);
	});

	it("`dispatch` returns an error envelope when the submit fails", async () => {
		const d = makeDeps();
		d.submitEffort = async () => {
			throw new Error("runtime HTTP 502");
		};
		const group = createVaultCapabilityGroup(d);
		const resolved = resolveGroupAction(group, ["dispatch", "search", "n.md"]);
		const err = await resolved!.action.run(resolved!.input);
		expect(err.ok).toBe(false);
		expect((err as { error?: string }).error).toBe("vault-dispatch-failed");
	});
});

describe("vault init — initialize a records vault (seed is INJECTED, not baked)", () => {
	const dirs: string[] = [];
	function tempDir(): string {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-vault-init-"));
		dirs.push(base);
		return path.join(base, "my-vault"); // a NOT-yet-existing subdir to init into
	}
	afterEach(() => {
		for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
	});

	// A caller-supplied seed — refarm ships none; the app (or a test) injects it.
	function seededManifest() {
		return {
			schemaVersion: 1,
			records: [
				{
					id: "record:starter",
					schemaVersion: 1,
					"@type": ["KnowledgeRecord"],
					"@context": "https://refarm.dev/contexts/records/v1",
					fields: { title: "Starter" },
					sections: [{ key: "description", content: "A seeded starter note." }],
				},
			],
		} as unknown as ReturnType<NonNullable<VaultCommandDeps["seed"]>>;
	}

	async function runInit(
		dir: string,
		options: Record<string, unknown> = {},
		seed?: VaultCommandDeps["seed"],
	): Promise<unknown> {
		const group = createVaultCapabilityGroup({ ...deps(), seed });
		if (!isCapabilityGroup(group)) throw new Error("expected a group");
		const init = group.actions.init;
		if (!init) throw new Error("no init action");
		return init.run({ args: { dir }, options: options as never, json: true });
	}

	it("seeds the vault from the INJECTED seed, rendered as markdown", async () => {
		const dir = tempDir();
		const envelope = (await runInit(dir, {}, seededManifest)) as {
			ok: boolean;
			seededCount: number;
			seededFiles: string[];
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.seededCount).toBeGreaterThan(0);

		// The seeded files are REAL Obsidian markdown: YAML-LD front matter that
		// round-trips back into a KnowledgeRecord.
		const first = envelope.seededFiles[0];
		expect(first).toBeTruthy();
		const markdown = fs.readFileSync(path.join(dir, first as string), "utf-8");
		expect(markdown.startsWith("---\n")).toBe(true);
		const { record } = parseRecordsYamlLdFrontMatter(markdown);
		expect(record.id).toBeTruthy();
		expect(record["@type"]).toContain("KnowledgeRecord");
	});

	it("creates an EMPTY vault when no seed is injected (refarm ships no seed)", async () => {
		const dir = tempDir();
		// No seed passed — refarm's default carries no domain content.
		const envelope = (await runInit(dir)) as { ok: boolean; seededCount: number };
		expect(envelope.ok).toBe(true);
		expect(envelope.seededCount).toBe(0);
		expect(fs.existsSync(dir)).toBe(true);
		expect(fs.readdirSync(dir)).toEqual([]);
	});

	it("--empty skips even an injected seed", async () => {
		const dir = tempDir();
		const envelope = (await runInit(dir, { empty: true }, seededManifest)) as {
			ok: boolean;
			seededCount: number;
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.seededCount).toBe(0);
		expect(fs.readdirSync(dir)).toEqual([]);
	});

	it("refuses to init over an existing path (never clobbers)", async () => {
		const dir = tempDir();
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "existing.md"), "keep me");
		const envelope = (await runInit(dir)) as { ok: boolean; error?: string };
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("vault_dir_exists");
		// The pre-existing file is untouched.
		expect(fs.readFileSync(path.join(dir, "existing.md"), "utf-8")).toBe("keep me");
	});
});
