import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildTrustedPublishingPlan } from "./trusted-publishing-plan.mjs";

const REGISTRY = "https://registry.npmjs.org/";
const TOKEN_ENV = "REFARM_NPM_BOOTSTRAP_TOKEN";

export function parseBootstrapPreflightArgs(argv = []) {
	const options = { selectionId: "consumer-ready", verifyToken: false, json: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") continue;
		if (arg === "--selection") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) throw new Error("--selection requires a value");
			options.selectionId = value;
			index += 1;
			continue;
		}
		if (arg === "--verify-token") {
			options.verifyToken = true;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		throw new Error(`Unknown bootstrap preflight option: ${arg}`);
	}
	return options;
}

export function buildBootstrapPreflight({ selectionId = "consumer-ready", verifyToken = false } = {}) {
	const trustedPlan = buildTrustedPublishingPlan({ selectionId });
	return {
		ok: trustedPlan.ok,
		selectionId,
		verifyToken,
		tokenEnv: TOKEN_ENV,
		workflow: "https://github.com/aretw0/refarm/actions/workflows/first-publish-selection.yml",
		links: {
			githubSecret: "https://github.com/aretw0/refarm/settings/secrets/actions",
			npmTokens: "https://www.npmjs.com/settings/~/tokens",
			npmTrustedPublishers: "https://www.npmjs.com/settings/~/packages",
		},
		checks: [
			"The selected packages still satisfy the release policy and declare 0.1.0.",
			"The first-publish workflow is manual and requires a typed confirmation.",
			"Token verification, when requested, only calls npm whoami; it never publishes.",
		],
		trustedPlan,
	};
}

export function verifyBootstrapToken({ token, run = spawnSync } = {}) {
	if (!token) throw new Error(`${TOKEN_ENV} is required with --verify-token`);
	const temporaryHome = mkdtempSync(path.join(os.tmpdir(), "refarm-npm-bootstrap-"));
	const userConfig = path.join(temporaryHome, ".npmrc");
	try {
		writeFileSync(userConfig, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
		const result = run("npm", ["whoami", "--registry", REGISTRY], {
			encoding: "utf8",
			env: { ...process.env, npm_config_userconfig: userConfig },
		});
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error("npm rejected the bootstrap token");
		return String(result.stdout ?? "").trim();
	} finally {
		rmSync(temporaryHome, { recursive: true, force: true });
	}
}

export function runBootstrapPreflightCli(argv = process.argv.slice(2), { env = process.env, run = spawnSync } = {}) {
	try {
		const options = parseBootstrapPreflightArgs(argv);
		const result = buildBootstrapPreflight(options);
		if (options.verifyToken) result.npmAccount = verifyBootstrapToken({ token: env[TOKEN_ENV], run });
		if (options.json) console.log(JSON.stringify(result, null, 2));
		else {
			console.log(`[bootstrap-preflight] ${result.selectionId}: ${result.ok ? "ready" : "blocked"}`);
			console.log(`[bootstrap-preflight] GitHub workflow: ${result.workflow}`);
			console.log(`[bootstrap-preflight] npm tokens: ${result.links.npmTokens}`);
			console.log(`[bootstrap-preflight] GitHub secret: ${result.links.githubSecret}`);
			if (result.npmAccount) console.log(`[bootstrap-preflight] authenticated npm account: ${result.npmAccount}`);
		}
		return result.ok ? 0 : 1;
	} catch (error) {
		console.error(`[bootstrap-preflight] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}
