import assert from "node:assert/strict";
import test from "node:test";
import {
	buildBootstrapPreflight,
	parseBootstrapPreflightArgs,
	runBootstrapPreflightCli,
	verifyBootstrapToken,
} from "./bootstrap-publish-preflight.mjs";

test("bootstrap preflight exposes operator links without reading a token", () => {
	const plan = buildBootstrapPreflight({ selectionId: "evidence-contracts-ready" });
	assert.equal(plan.ok, true);
	assert.equal(plan.workflow, "https://github.com/aretw0/refarm/actions/workflows/first-publish-selection.yml");
	assert.equal(plan.tokenEnv, "REFARM_NPM_BOOTSTRAP_TOKEN");
	assert.equal(plan.trustedPlan.packages.length, 3);
});

test("token verification only accepts an explicit environment value", () => {
	assert.throws(() => verifyBootstrapToken(), /REFARM_NPM_BOOTSTRAP_TOKEN is required/);
	let invoked = false;
	const account = verifyBootstrapToken({
		token: "test-token",
		run(command, args) {
			invoked = true;
			assert.equal(command, "npm");
			assert.deepEqual(args, ["whoami", "--registry", "https://registry.npmjs.org/"]);
			return { status: 0, stdout: "refarm-bot\n" };
		},
	});
	assert.equal(invoked, true);
	assert.equal(account, "refarm-bot");
});

test("unknown options fail instead of silently skipping a bootstrap guard", () => {
	assert.throws(() => parseBootstrapPreflightArgs(["--publish"]), /Unknown bootstrap preflight option/);
});

test("CLI reports a missing verification token as a failure", () => {
	const output = [];
	const original = console.error;
	console.error = (line) => output.push(line);
	try {
		assert.equal(runBootstrapPreflightCli(["--verify-token"], { env: {} }), 1);
	} finally {
		console.error = original;
	}
	assert.match(output.join("\n"), /REFARM_NPM_BOOTSTRAP_TOKEN is required/);
});
