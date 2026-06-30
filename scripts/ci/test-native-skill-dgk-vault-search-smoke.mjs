import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildNativeSkillDgkVaultSearchSmoke } from "./native-skill-dgk-vault-search-smoke.mjs";

const pexec = promisify(execFile);

const SAFE_VAULT_SEARCH_BODY = `
# Vault Search

Busque notas com \`dgk lab note search\`:

\`\`\`bash
dgk lab note search query="aprendizado de maquina"
dgk lab note search tags="ia,pkm"
dgk lab note search folder="20 - Resources"
\`\`\`

O resultado lista os nomes e caminhos das notas correspondentes.

## Pre-requisito

O Obsidian CLI deve estar registrado antes de usar a skill no produto downstream.
`;

function writeDgkSkill(root, { body = SAFE_VAULT_SEARCH_BODY } = {}) {
	const filePath = path.join(root, "packages/dgk-skills/skills/vault-search/SKILL.md");
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		`---\nname: vault-search\ndescription: Busca notas no vault do usuario por palavra-chave, tag ou texto completo usando o Obsidian CLI\nversion: 0.1.0\n---\n\n${body}\n`,
		"utf8",
	);
}

async function git(args, cwd) {
	await pexec("git", args, { cwd });
}

async function createVaultSeedFixture() {
	const sourceDir = mkdtempSync(path.join(os.tmpdir(), "dgk-vault-search-smoke-"));
	writeDgkSkill(sourceDir);
	await git(["init", sourceDir]);
	await git(["-C", sourceDir, "config", "user.email", "dgk-vault-search-smoke@test.dev"]);
	await git(["-C", sourceDir, "config", "user.name", "DGK Vault Search Smoke Test"]);
	await git(["-C", sourceDir, "add", "."]);
	await git(["-C", sourceDir, "commit", "-m", "init"]);
	return sourceDir;
}

test("DGK vault-search smoke wraps external skill evidence without installing or executing it", async () => {
	const sourceDir = await createVaultSeedFixture();
	const result = await buildNativeSkillDgkVaultSearchSmoke({
		sourceDir,
		completedAt: "2026-06-30T00:00:00.000Z",
	});

	assert.equal(result.schemaVersion, 1);
	assert.equal(result.command, "native-skill-dgk-vault-search-smoke");
	assert.equal(result.ok, true);
	assert.equal(result.mode, "external-skill-wrapper-dogfood-smoke");
	assert.equal(result.executesRuntimeAgent, false);
	assert.equal(result.executesEngine, true);
	assert.equal(result.installsExternalSkill, false);
	assert.equal(result.executesDgk, false);
	assert.equal(result.selectedExternalSkill.id, "dgk-skills/vault-search");
	assert.equal(
		result.selectedExternalSkill.sourcePath,
		"packages/dgk-skills/skills/vault-search/SKILL.md",
	);
	assert.match(result.selectedExternalSkill.sha256, /^[a-f0-9]{64}$/);
	assert.equal(result.selectedExternalSkill.decision, "requires-refarm-wrapper-before-install");
	assert.equal(result.wrapperSkill.name, "dgk-vault-search-refarm-wrapper");
	assert.equal(result.wrapperSkill.assetPath, "skills/dgk-vault-search-refarm-wrapper/SKILL.md");
	assert.equal(result.pluginManifest.id, "@refarm.dev/dgk-vault-search-skill-wrapper");
	assert.equal(result.pluginManifest.valid, true);
	assert.equal(result.surface.layer, "pi");
	assert.equal(result.surface.kind, "skill");
	assert.equal(result.surface.id, "dgk-vault-search-refarm-wrapper");
	assert.deepEqual(result.surface.assets, ["skills/dgk-vault-search-refarm-wrapper/SKILL.md"]);
	assert.deepEqual(result.surface.capabilities, [
		"refarm.operator-loop",
		"source:v1",
	]);
	assert.equal(result.activationPreflight.schema, "refarm.skill-activation-preflight.v1");
	assert.equal(result.activationPreflight.state, "blocked");
	assert.equal(result.activationPreflight.readyForRuntimeDispatch, false);
	assert.deepEqual(
		result.activationPreflight.issues.map((item) => item.code),
		[
			"ACTIVATION_INTEGRITY_NOT_VERIFIED",
			"ACTIVATION_POLICY_NOT_ACCEPTED",
		],
	);
	assert.deepEqual(result.plan.capabilityRequests, [
		{ id: "refarm.operator-loop", required: true },
		{ id: "source:v1", required: true },
	]);
	assert.deepEqual(result.plan.engineBindings.requires, ["source:v1"]);
	assert.equal(result.decision.schema, "refarm.skill-invocation-decision.v1");
	assert.equal(result.decision.decision, "approved");
	assert.equal(result.decision.executed, false);
	assert.equal(result.receipt.schema, "refarm.skill-invocation-receipt.v1");
	assert.equal(result.receipt.status, "succeeded");
	assert.equal(result.receipt.executed, true);
	assert.equal(result.receipt.completedAt, "2026-06-30T00:00:00.000Z");
	assert.equal(result.receipt.engineCalls[0].engineBinding, "source:v1");
	assert.equal(result.receipt.engineCalls[0].providerId, "@refarm.dev/source-local");
	assert.equal(result.sourceStatus.materialized, true);
	assert.equal(result.sourceStatus.clean, true);
	assert.match(result.receipt.output.body, /DGK vault-search wrapper evidence/);
	assert.match(result.boundaries.join("\n"), /does not execute dgk/);
	assert.match(result.boundaries.join("\n"), /package skill surface/);
	assert.match(result.boundaries.join("\n"), /activation preflight as blocked/);
	assert.match(result.nextActions.join("\n"), /first external skill fixture proof/);
	assert.match(result.nextActions.join("\n"), /package-declared pi\/skill surface/);
	assert.match(result.nextActions.join("\n"), /activation preflight/);
	assert.deepEqual(result.issues, []);
});

test("DGK vault-search smoke records dirty upstream status as evidence", async () => {
	const sourceDir = await createVaultSeedFixture();
	writeFileSync(path.join(sourceDir, "UNTRACKED.md"), "# local downstream work\n", "utf8");

	const result = await buildNativeSkillDgkVaultSearchSmoke({ sourceDir });

	assert.equal(result.ok, true);
	assert.equal(result.sourceStatus.materialized, true);
	assert.equal(result.sourceStatus.clean, false);
	assert.equal(result.sourceStatus.untracked, true);
	assert.match(result.receipt.output.body, /source untracked: true/);
});

test("DGK vault-search smoke fails closed on upstream mutation markers", async () => {
	const sourceDir = await createVaultSeedFixture();
	writeDgkSkill(sourceDir, {
		body: `${SAFE_VAULT_SEARCH_BODY}\nUse dgk lab note delete name="old".\n`,
	});

	const result = await buildNativeSkillDgkVaultSearchSmoke({ sourceDir });

	assert.equal(result.ok, false);
	assert.equal(result.executesRuntimeAgent, false);
	assert.equal(result.installsExternalSkill, false);
	assert.equal(result.executesDgk, false);
	assert.equal(
		result.issues.some((item) => item.code === "DGK_VAULT_SEARCH_REVIEW_NOT_READY"),
		true,
	);
	assert.match(JSON.stringify(result.issues), /reject-or-edit-source-before-install/);
});
