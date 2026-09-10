#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildReleaseCheckPlan } from "../release-check.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const TRUSTED_PUBLISHING_REPOSITORY = "aretw0/refarm";
export const TRUSTED_PUBLISHING_WORKFLOW = "release-changesets.yml";
export const TRUSTED_PUBLISHING_NPM_VERSION = "11.15.0";

export function parseTrustedPublishingPlanArgs(argv = []) {
	const options = { selectionId: "consumer-ready", json: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") continue;
		if (arg === "--selection") {
			options.selectionId = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		throw new Error(`Unknown trusted-publishing option: ${arg}`);
	}
	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
	return value;
}

function repositoryUrl(repository) {
	return typeof repository === "string" ? repository : repository?.url ?? null;
}

function npmPackageUrl(packageName) {
	return `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`;
}

export function buildTrustedPublishingPlan({ cwd = ROOT, selectionId = "consumer-ready" } = {}) {
	const release = buildReleaseCheckPlan({ cwd, selectionId });
	if (!release.ok) return { ok: false, release, packages: [], blockers: ["release-policy"] };

	const expectedRepositoryUrl = `https://github.com/${TRUSTED_PUBLISHING_REPOSITORY}.git`;
	const packages = release.commands.map((command) => {
		const manifest = JSON.parse(readFileSync(path.join(command.cwd, "package.json"), "utf8"));
		const actualRepositoryUrl = repositoryUrl(manifest.repository);
		return {
			name: command.packageName,
			version: manifest.version,
			packageDir: command.packageDir,
			npmUrl: npmPackageUrl(command.packageName),
			repositoryUrl: actualRepositoryUrl,
			repositoryMatches: actualRepositoryUrl === expectedRepositoryUrl,
			trustCommand: [
				"npx", "--yes", `npm@^${TRUSTED_PUBLISHING_NPM_VERSION}`,
				"trust", "github", command.packageName,
				"--file", TRUSTED_PUBLISHING_WORKFLOW,
				"--repo", TRUSTED_PUBLISHING_REPOSITORY,
				"--allow-stage-publish", "--yes",
			].join(" "),
		};
	});
	const repositoryMismatches = packages.filter((pkg) => !pkg.repositoryMatches).map((pkg) => pkg.name);
	return {
		ok: repositoryMismatches.length === 0,
		selectionId,
		strategy: "bootstrap-token-then-stage-only-oidc",
		bootstrap: {
			workflow: "first-publish-selection.yml",
			secret: "NPM_TOKEN",
			confirmation: `publish-${selectionId}-0.1.0`,
			note: "Use the token only for the inaugural publish. Do not paste it into this command or commit it.",
		},
		trustedPublisher: {
			repository: TRUSTED_PUBLISHING_REPOSITORY,
			workflow: TRUSTED_PUBLISHING_WORKFLOW,
			allowedAction: "npm stage publish",
			npmVersion: `>=${TRUSTED_PUBLISHING_NPM_VERSION}`,
		},
		links: {
			githubSecrets: `https://github.com/${TRUSTED_PUBLISHING_REPOSITORY}/settings/secrets/actions`,
			githubVariables: `https://github.com/${TRUSTED_PUBLISHING_REPOSITORY}/settings/variables/actions`,
			githubEnvironments: `https://github.com/${TRUSTED_PUBLISHING_REPOSITORY}/settings/environments`,
			npmTrustedPublishingDocs: "https://docs.npmjs.com/trusted-publishers/",
			npmTrustDocs: "https://docs.npmjs.com/cli/v11/commands/npm-trust/",
		},
		expectedRepositoryUrl,
		repositoryMismatches,
		packages,
	};
}

export function printTrustedPublishingPlan(plan, json) {
	if (json) return console.log(JSON.stringify(plan, null, 2));
	console.log(`[trusted-publishing] ${plan.selectionId}: ${plan.packages.length} package(s)`);
	console.log(`[trusted-publishing] bootstrap: ${plan.bootstrap.workflow} with GitHub secret ${plan.bootstrap.secret}`);
	console.log(`[trusted-publishing] then configure stage-only OIDC for ${plan.trustedPublisher.workflow}`);
	console.log(`[trusted-publishing] trust commands require npm ${plan.trustedPublisher.npmVersion}, a local npm login, and 2FA.`);
	if (plan.repositoryMismatches.length > 0) {
		console.log(`[trusted-publishing] BLOCKED: repository.url must be ${plan.expectedRepositoryUrl}: ${plan.repositoryMismatches.join(", ")}`);
		return;
	}
	for (const pkg of plan.packages) console.log(pkg.trustCommand);
}
