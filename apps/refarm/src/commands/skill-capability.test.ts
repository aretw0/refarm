import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/cli/capabilities";
import type { DiscoveredSkill } from "@refarm.dev/plugin-surface-loader/node";
import { openScopedLedger } from "@refarm.dev/storage-node-view";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	createSkillCapabilityGroup,
	loadPersistedImportedSkills,
	persistImportedSkillsToLedger,
	skillCapabilityHooks,
	type SkillCommandDeps,
} from "./skill-capability.js";

/**
 * An HONEST content-addressed source ref — the sha256 of the instruction bytes it
 * points at (the loaders produce exactly this). It must be the real hash: the
 * persistence path stores the bytes under this address and the resolver verifies
 * them on read, so a made-up hash would `hash-mismatch`. Pass the instructions the
 * fixture actually carries; defaults to a stable stand-in.
 */
function sourceRef(instructions = "fixture-body") {
	const bytes = new TextEncoder().encode(instructions);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return {
		format: "SKILL.md" as const,
		uri: "fixture:SKILL.md",
		sha256,
		bytes: bytes.byteLength,
	};
}

function skill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
	return {
		surfaceId: "greet",
		id: "urn:skill:greet",
		name: "greet-operator",
		description: "Greet the operator.",
		requiredCapabilities: ["refarm.operator-loop"],
		instructions: "# Greet\n\nGreet the operator and summarize the day.",
		source: sourceRef(),
		pluginId: "@demo/plugin",
		pluginDir: "/plugins/demo",
		...overrides,
	};
}

type Rejected = ReturnType<SkillCommandDeps["discover"]>["rejected"];
type Checker = Awaited<ReturnType<SkillCommandDeps["loadCheckers"]>>[number];
type ImportResult = ReturnType<SkillCommandDeps["importSkills"]>;
type PersistedResult = Awaited<
	ReturnType<SkillCommandDeps["loadPersistedSkills"]>
>;

type Profiles = ReturnType<SkillCommandDeps["loadProfiles"]>;

function deps(
	skills: DiscoveredSkill[] = [],
	rejected: Rejected = [],
	checkers: Checker[] = [],
	imported: ImportResult = { skills: [], rejected: [] },
	persisted: string[] = [],
	persistedSkills: PersistedResult = { skills: [], rejected: [] },
	profiles: Profiles = [],
): SkillCommandDeps {
	return {
		discover: () => ({ skills, rejected }),
		loadPersistedSkills: async () => persistedSkills,
		loadCheckers: async () => checkers,
		loadProfiles: () => profiles,
		importSkills: () => imported,
		persistSkills: async () => persisted,
	};
}

describe("skill CapabilityGroup", () => {
	it("is a group with list + show + check + import + invoke and a read-only list default", () => {
		const group = createSkillCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual([
			"check",
			"import",
			"invoke",
			"list",
			"show",
		]);
		expect(group.defaultAction).toBe("list");
	});

	it("carries multi-surface hints from one declaration", () => {
		const group = createSkillCapabilityGroup(deps());
		expect(group.transports?.cli).toBeDefined();
		expect(group.transports?.repl?.slashAliases).toContain("skills");
		expect(group.transports?.http).toEqual({ method: "GET", path: "/skills" });
	});

	it("`list` projects plugin and imported ledger skills with maturity hints", async () => {
		const group = createSkillCapabilityGroup(
			deps(
				[skill()],
				[],
				[],
				{ skills: [], rejected: [] },
				[],
				{
					skills: [
						{
							surfaceId: "note",
							id: "urn:skill:note",
							name: "note",
							requiredCapabilities: [],
							instructions: "Take a note.",
							ledgerScope: "user",
						},
					],
					rejected: [],
				},
			),
		);
		const resolved = resolveGroupAction(group, []);
		expect(resolved?.key).toBe("list");
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			count: number;
			skills: { name: string; maturity: string; source: string; sourceLabel: string }[];
		};
		expect(envelope.count).toBe(2);
		expect(envelope.skills.find((s) => s.name === "greet-operator")?.maturity).toBe(
			"complete",
		);
		expect(envelope.skills.find((s) => s.name === "greet-operator")?.source).toBe(
			"plugin",
		);
		// A skill with no capabilities is surfaced as permissive (hint, not gate).
		expect(envelope.skills.find((s) => s.name === "note")?.maturity).toBe(
			"permissive",
		);
		expect(envelope.skills.find((s) => s.name === "note")?.sourceLabel).toBe(
			"imported ledger (user)",
		);
	});

	it("`show <id>` resolves by id or name; unknown → error envelope", async () => {
		const group = createSkillCapabilityGroup(deps([skill()]));

		const byName = resolveGroupAction(group, ["show", "greet-operator"]);
		const ok = await byName!.action.run(byName!.input);
		expect(ok.ok).toBe(true);
		const shown = (ok as { skill?: { name: string; instructions?: string } }).skill;
		expect(shown?.name).toBe("greet-operator");
		// `show` is the read view of one skill: it carries the instruction body
		// (for an imported skill, the bytes resolved + verified from the store).
		expect(shown?.instructions).toBe(
			"# Greet\n\nGreet the operator and summarize the day.",
		);

		const byId = resolveGroupAction(group, ["show", "urn:skill:greet"]);
		expect((await byId!.action.run(byId!.input)).ok).toBe(true);

		const missing = resolveGroupAction(group, ["show", "nope"]);
		const err = await missing!.action.run(missing!.input);
		expect(err.ok).toBe(false);
		expect((err as { error?: string }).error).toBe("skill-not-found");
	});

	it("`check <id>` runs checkers over the skill text → findings as pending-actions", async () => {
		// A fake checker standing in for the sandboxed WASM one: it fires on the
		// skill's instructions and returns a finding.
		const fakeChecker: Checker = {
			check: () => [
				{
					severity: "warn",
					ruleId: "ai-self-reference",
					message: "AI tell in instructions",
				},
			],
		};
		const group = createSkillCapabilityGroup(
			deps(
				[skill({ instructions: "As an AI language model, I help." })],
				[],
				[fakeChecker],
			),
		);
		const resolved = resolveGroupAction(group, ["check", "greet-operator"]);
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			findingCount: number;
			checkersRun: number;
			recommendations: { diagnostic: string }[];
			nextActions: string[];
		};
		// Findings are POLICY: ok stays true (a skill with tells still exists), but
		// a pending-action is surfaced on the tri-interface.
		expect(envelope.ok).toBe(true);
		expect(envelope.checkersRun).toBe(1);
		expect(envelope.findingCount).toBe(1);
		expect(envelope.recommendations[0]!.diagnostic).toBe("ai-self-reference");
		expect(envelope.nextActions.length).toBeGreaterThan(0);
	});

	it("`check` runs each checker over the built-in AND plugin-contributed profiles", async () => {
		// A checker that fires ONE finding per profile whose name it was handed —
		// so the count proves both the built-in and the plugin profile reached it.
		const perProfileChecker: Checker = {
			check: (_subject, profile) => [
				{
					severity: "warn",
					ruleId: `saw-${profile.name}`,
					message: `ran profile ${profile.name}`,
				},
			],
		};
		const pluginProfile = {
			name: "custom-tells",
			rules: [
				{
					id: "no-forbidden",
					severity: "warn",
					description: "forbidden word",
					check: JSON.stringify({ type: "contains", value: "forbidden" }),
				},
			],
		};
		const group = createSkillCapabilityGroup(
			deps(
				[skill()],
				[],
				[perProfileChecker],
				{ skills: [], rejected: [] },
				[],
				{ skills: [], rejected: [] },
				[pluginProfile],
			),
		);
		const resolved = resolveGroupAction(group, ["check", "greet-operator"]);
		const env = (await resolved!.action.run(resolved!.input)) as unknown as {
			findingCount: number;
			recommendations: { diagnostic: string }[];
		};
		// One finding for the built-in skill-tells profile + one for the plugin's.
		expect(env.findingCount).toBe(2);
		const seen = env.recommendations.map((r) => r.diagnostic);
		expect(seen).toContain("saw-skill-tells");
		expect(seen).toContain("saw-custom-tells");
	});

	it("`check` with no findings reports ok and zero pending-actions", async () => {
		const cleanChecker: Checker = { check: () => [] };
		const group = createSkillCapabilityGroup(
			deps([skill()], [], [cleanChecker]),
		);
		const resolved = resolveGroupAction(group, ["check", "greet-operator"]);
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			findingCount: number;
			nextActions: string[];
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.findingCount).toBe(0);
		expect(envelope.nextActions).toEqual([]);
	});

	it("`import <dir>` reports translated Agent Skills from a directory", async () => {
		const group = createSkillCapabilityGroup(
			deps([], [], [], {
				skills: [
					{
						surfaceId: "commit",
						id: "urn:skill:commit",
						name: "commit",
						description: "Read before committing",
						requiredCapabilities: [],
						instructions: "Make a commit.",
						skillDir: "/ext/skills/commit",
						translated: { nameInjected: false, newlinesNormalized: false },
						source: sourceRef(),
					},
					{
						surfaceId: "win",
						id: "urn:skill:win",
						name: "win",
						requiredCapabilities: [],
						instructions: "Body.",
						skillDir: "/ext/skills/win",
						translated: { nameInjected: true, newlinesNormalized: true },
						source: sourceRef(),
					},
				],
				rejected: [{ skillDir: "/ext/skills/bad", issues: ["FRONTMATTER_MISSING: x"] }],
			}),
		);
		const resolved = resolveGroupAction(group, ["import", "/ext/skills"]);
		expect(resolved?.key).toBe("import");
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			source: string;
			count: number;
			imported: { name: string; translated: { nameInjected: boolean } }[];
			rejected: { skillDir: string }[];
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.source).toBe("/ext/skills");
		expect(envelope.count).toBe(2);
		expect(envelope.imported.map((s) => s.name).sort()).toEqual(["commit", "win"]);
		expect(envelope.imported.find((s) => s.name === "win")?.translated.nameInjected).toBe(true);
		expect(envelope.rejected).toHaveLength(1);
		// Report-only by default: nothing persisted, and a --write next-command.
		expect((envelope as unknown as { persisted: boolean }).persisted).toBe(false);
		expect((envelope as unknown as { nextCommand?: string }).nextCommand).toContain(
			"--write",
		);
	});

	it("`import <dir> --write` persists the imported skills (content-addressed)", async () => {
		const importResult: ImportResult = {
			skills: [
				{
					surfaceId: "commit",
					id: "urn:refarm:skill:v1:commit:abc123",
					name: "commit",
					requiredCapabilities: [],
					instructions: "Make a commit.",
					skillDir: "/ext/skills/commit",
					translated: { nameInjected: false, newlinesNormalized: false },
					source: sourceRef(),
				},
			],
			rejected: [],
		};
		const group = createSkillCapabilityGroup(
			deps([], [], [], importResult, ["urn:refarm:skill:v1:commit:abc123"]),
		);
		const resolved = resolveGroupAction(group, [
			"import",
			"/ext/skills",
			"--write",
		]);
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			persisted: boolean;
			written: string[];
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.persisted).toBe(true);
		// The persisted id is the CONTENT-ADDRESSED id (sha256 in the urn) — the
		// same seam a p2p/OPFS resolver would key on.
		expect(envelope.written).toEqual(["urn:refarm:skill:v1:commit:abc123"]);
	});

	it("persists imported skills to the user ledger and loads them back for list", async () => {
		const homeParent = mkdtempSync(join(tmpdir(), "refarm-skill-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "refarm-skill-ws-"));
		const roots = { userHome: homeParent, workspaceRoot };
		try {
			const imported: ImportResult["skills"] = [
				{
					surfaceId: "commit",
					id: "urn:refarm:skill:v1:commit:abc123",
					name: "commit",
					description: "Read before committing",
					requiredCapabilities: [],
					instructions: "Make a commit.",
					skillDir: "/ext/skills/commit",
					translated: { nameInjected: false, newlinesNormalized: false },
					source: sourceRef("Make a commit."),
				},
			];
			await expect(
				persistImportedSkillsToLedger(imported, "user", roots),
			).resolves.toEqual(["urn:refarm:skill:v1:commit:abc123"]);

			const loaded = await loadPersistedImportedSkills(roots);
			expect(loaded.rejected).toEqual([]);
			expect(loaded.skills).toHaveLength(1);
			expect(loaded.skills[0]).toMatchObject({
				id: "urn:refarm:skill:v1:commit:abc123",
				name: "commit",
				ledgerScope: "user",
			});

			const group = createSkillCapabilityGroup(
				deps([], [], [], { skills: [], rejected: [] }, [], loaded),
			);
			const resolved = resolveGroupAction(group, ["list"]);
			const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
				count: number;
				skills: { name: string; sourceLabel: string }[];
			};
			expect(envelope.count).toBe(1);
			expect(envelope.skills[0]).toMatchObject({
				name: "commit",
				sourceLabel: "imported ledger (user)",
			});
		} finally {
			rmSync(homeParent, { recursive: true, force: true });
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("folds org → workspace → user; user override wins, org base shows through", async () => {
		const homeParent = mkdtempSync(join(tmpdir(), "refarm-skill-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "refarm-skill-ws-"));
		const orgRoot = mkdtempSync(join(tmpdir(), "refarm-skill-org-"));
		const roots = { userHome: homeParent, workspaceRoot, orgRoot };
		try {
			// Org distributes a base skill; a workspace re-imports it (same content =
			// same content-addressed id = override, not a duplicate); the user tier
			// only carries its own personal skill.
			const shared = (instructions: string): ImportResult["skills"][number] => ({
				surfaceId: "shared",
				id: "urn:refarm:skill:v1:shared:aaaa1111",
				name: "shared",
				requiredCapabilities: [],
				instructions,
				skillDir: "/x/shared",
				translated: { nameInjected: false, newlinesNormalized: false },
				source: sourceRef(instructions),
			});
			const orgOnly: ImportResult["skills"][number] = {
				surfaceId: "org-base",
				id: "urn:refarm:skill:v1:org-base:bbbb2222",
				name: "org-base",
				requiredCapabilities: [],
				instructions: "org-only skill",
				skillDir: "/x/org-base",
				translated: { nameInjected: false, newlinesNormalized: false },
				source: sourceRef("org-only skill"),
			};
			await persistImportedSkillsToLedger([shared("ORG"), orgOnly], "org", roots);
			await persistImportedSkillsToLedger([shared("WORKSPACE")], "workspace", roots);

			const loaded = await loadPersistedImportedSkills(roots);
			const byId = new Map(loaded.skills.map((s) => [s.id, s]));
			// Same content-addressed id: workspace overrides org (higher precedence),
			// and there is ONE effective skill, not two.
			expect(loaded.skills.filter((s) => s.name === "shared")).toHaveLength(1);
			expect(byId.get("urn:refarm:skill:v1:shared:aaaa1111")).toMatchObject({
				instructions: "WORKSPACE",
				ledgerScope: "workspace",
			});
			// The org-only skill still shows through (base inherited).
			expect(byId.get("urn:refarm:skill:v1:org-base:bbbb2222")).toMatchObject({
				ledgerScope: "org",
			});
		} finally {
			rmSync(homeParent, { recursive: true, force: true });
			rmSync(workspaceRoot, { recursive: true, force: true });
			rmSync(orgRoot, { recursive: true, force: true });
		}
	});

	it("stores instructions in the content-store by sha256, NOT inline in the node", async () => {
		const homeParent = mkdtempSync(join(tmpdir(), "refarm-skill-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "refarm-skill-ws-"));
		const roots = { userHome: homeParent, workspaceRoot };
		try {
			const instructions = "Read the diff before you commit.";
			await persistImportedSkillsToLedger(
				[
					{
						surfaceId: "commit",
						id: "urn:refarm:skill:v1:commit:abc123",
						name: "commit",
						requiredCapabilities: [],
						instructions,
						skillDir: "/x/commit",
						translated: { nameInjected: false, newlinesNormalized: false },
						source: sourceRef(instructions),
					},
				],
				"user",
				roots,
			);

			// The bytes live at <user>/.refarm/assets/<sha256>, verbatim.
			const hash = createHash("sha256").update(instructions).digest("hex");
			const assetPath = join(homeParent, ".refarm", "assets", hash);
			expect(existsSync(assetPath)).toBe(true);
			expect(readFileSync(assetPath, "utf8")).toBe(instructions);

			// The ledger node is a POINTER — it carries the hash, not the bytes.
			const ledgerPath = join(homeParent, ".refarm", "skills", "ledger.json");
			const ledgerRaw = readFileSync(ledgerPath, "utf8");
			expect(ledgerRaw).toContain(hash);
			expect(ledgerRaw).not.toContain("Read the diff before you commit.");

			// And it still round-trips: the pointer resolves the bytes back...
			const loaded = await loadPersistedImportedSkills(roots);
			expect(loaded.skills[0]?.instructions).toBe(instructions);

			// ...all the way to `show`, which carries the resolved body.
			const group = createSkillCapabilityGroup(
				deps([], [], [], { skills: [], rejected: [] }, [], loaded),
			);
			const shown = resolveGroupAction(group, ["show", "commit"]);
			const env = (await shown!.action.run(shown!.input)) as unknown as {
				skill: { instructions?: string };
			};
			expect(env.skill.instructions).toBe(instructions);
		} finally {
			rmSync(homeParent, { recursive: true, force: true });
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("still lists a LEGACY inline node (no sha256) — migration is non-destructive", async () => {
		const homeParent = mkdtempSync(join(tmpdir(), "refarm-skill-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "refarm-skill-ws-"));
		const roots = { userHome: homeParent, workspaceRoot };
		try {
			// Persist a pre-content-store node through the real ledger API: it inlines
			// instructions with no sha256 pointer — the exact shape 8bb00fa9 wrote.
			const ledger = openScopedLedger("skills", "user", roots);
			await ledger.storeNode({
				"@id": "urn:refarm:skill:v1:legacy:deadbeef",
				"@type": "refarm:imported-skill",
				surfaceId: "legacy",
				name: "legacy",
				requiredCapabilities: [],
				instructions: "old inline body",
			} as never);

			const loaded = await loadPersistedImportedSkills(roots);
			expect(loaded.rejected).toEqual([]);
			expect(loaded.skills).toHaveLength(1);
			expect(loaded.skills[0]).toMatchObject({
				id: "urn:refarm:skill:v1:legacy:deadbeef",
				instructions: "old inline body",
				ledgerScope: "user",
			});
		} finally {
			rmSync(homeParent, { recursive: true, force: true });
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("`import --scope org` persists to the org tier; unknown scope errors", async () => {
		let capturedScope: string | undefined;
		const group = createSkillCapabilityGroup({
			...deps([], [], [], {
				skills: [
					{
						surfaceId: "s",
						id: "urn:refarm:skill:v1:s:cccc3333",
						name: "s",
						requiredCapabilities: [],
						instructions: "body",
						skillDir: "/x/s",
						translated: { nameInjected: false, newlinesNormalized: false },
						source: sourceRef(),
					},
				],
				rejected: [],
			}),
			persistSkills: async (_skills, scope) => {
				capturedScope = scope;
				return ["urn:refarm:skill:v1:s:cccc3333"];
			},
		});

		const ok = resolveGroupAction(group, ["import", "/x", "--write", "--scope", "org"]);
		const env = (await ok!.action.run(ok!.input)) as unknown as {
			ok: boolean;
			scope: string;
		};
		expect(env.ok).toBe(true);
		expect(env.scope).toBe("org");
		expect(capturedScope).toBe("org");

		const bad = resolveGroupAction(group, ["import", "/x", "--write", "--scope", "nope"]);
		const badEnv = await bad!.action.run(bad!.input);
		expect(badEnv.ok).toBe(false);
		expect((badEnv as { error?: string }).error).toBe("unknown-ledger-scope");
	});

	it("hooks render the import listing (with translation tags) and a not-found error", () => {
		const listing = skillCapabilityHooks("import").renderText!({
			ok: true,
			source: "/ext/skills",
			count: 1,
			imported: [
				{
					name: "win",
					id: "urn:skill:win",
					translated: { nameInjected: true, newlinesNormalized: true },
					source: sourceRef(),
				},
			],
			rejected: [],
		} as never);
		expect(listing).toContain("win");
		expect(listing).toContain("name-injected");
	});

	it("hooks render the empty-state hint and a not-found error", () => {
		const emptyList = skillCapabilityHooks("list").renderText!(
			{ count: 0, skills: [], rejected: [] } as never,
		);
		expect(emptyList).toContain("No skills found");

		const notFound = skillCapabilityHooks("show").renderText!({
			ok: false,
			message: 'No installed skill matches "nope".',
		} as never);
		expect(notFound).toContain("nope");
	});

	it("hooks render check findings + a no-findings pass", () => {
		const withFindings = skillCapabilityHooks("check").renderText!({
			ok: true,
			skill: { name: "greet-operator" },
			findingCount: 1,
			checkersRun: 2,
			recommendations: [
				{ diagnostic: "ai-self-reference", summary: "AI tell" },
			],
			nextActions: ["Revise the skill's instructions."],
		} as never);
		expect(withFindings).toContain("ai-self-reference");
		expect(withFindings).toContain("pending action");

		const clean = skillCapabilityHooks("check").renderText!({
			ok: true,
			skill: { name: "greet-operator" },
			findingCount: 0,
			checkersRun: 1,
			recommendations: [],
			nextActions: [],
		} as never);
		expect(clean).toContain("no findings");
	});
});

describe("skill invoke action (plan-only, approval-gated)", () => {
	const SKILL_MD = `---
name: git-flow
description: A git workflow.
requiredCapabilities:
  - refarm.operator-loop
engineBindings:
  - runtime-agent
input: Task context.
inputRequired: true
output: A plan.
---

# Git Flow

Run the loop.
`;

	function skillDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "invoke-skill-"));
		writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
		return dir;
	}

	it("is exposed as a `skill invoke` sub-action", () => {
		const group = createSkillCapabilityGroup(deps());
		expect(Object.keys(group.actions)).toContain("invoke");
	});

	it("plans a SKILL.md directory read-only (no input, no decision)", async () => {
		const dir = skillDir();
		try {
			const group = createSkillCapabilityGroup(deps());
			const resolved = resolveGroupAction(group, ["invoke", dir]);
			const env = (await resolved!.action.run(resolved!.input)) as unknown as {
				ok: boolean;
				plan?: { skill?: { name: string } };
				decision: unknown;
				persisted: boolean;
			};
			expect(env.ok).toBe(true);
			expect(env.plan?.skill?.name).toBe("git-flow");
			expect(env.decision).toBeNull();
			expect(env.persisted).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("errors when the directory has no SKILL.md", async () => {
		const dir = mkdtempSync(join(tmpdir(), "invoke-empty-"));
		try {
			const group = createSkillCapabilityGroup(deps());
			const resolved = resolveGroupAction(group, ["invoke", dir]);
			const env = await resolved!.action.run(resolved!.input);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("skill-md-not-found");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("requires --input before recording an approval/denial decision", async () => {
		const dir = skillDir();
		try {
			const group = createSkillCapabilityGroup(deps());
			const resolved = resolveGroupAction(group, ["invoke", dir, "--deny"]);
			const env = await resolved!.action.run(resolved!.input);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe(
				"input-required-for-decision",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects an unknown --scope", async () => {
		const dir = skillDir();
		try {
			const group = createSkillCapabilityGroup(deps());
			const resolved = resolveGroupAction(group, [
				"invoke",
				dir,
				"--scope",
				"nope",
			]);
			const env = await resolved!.action.run(resolved!.input);
			expect(env.ok).toBe(false);
			expect((env as { error?: string }).error).toBe("unknown-ledger-scope");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
