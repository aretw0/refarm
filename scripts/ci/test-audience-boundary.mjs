import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function read(path) {
	return readFileSync(path, "utf8");
}

test("README separates future users, developers, and release operators", () => {
	const readme = read("README.md");

	const status = readme.indexOf("## Current Status");
	const users = readme.indexOf("## For Future Users");
	const developers = readme.indexOf("## For Developers");
	const operators = readme.indexOf("## For Release And Deploy Operators");

	assert.ok(status > 0, "README needs a current status section");
	assert.ok(users > status, "future-user surface should follow status");
	assert.ok(developers > users, "developer surface should follow user context");
	assert.ok(operators > developers, "release/deploy operator surface should follow developer context");
	assert.match(readme, /Public end-user use is not released yet/);
	assert.match(readme, /This repository is not yet a polished product download/);
	assert.match(readme, /Release and deploy surfaces are intentionally separate/);
	assert.doesNotMatch(readme, /incr[ií]vel|world-class|estado da arte|liberar o potencial|jornada/i);
});

test("release and deploy workflow contract is discoverable from README", () => {
	const readme = read("README.md");

	for (const command of [
		"pnpm run actions:pins",
		"pnpm run deploy:publish:workflow:test",
		"pnpm run release:check",
		"pnpm run runtime-descriptor:release-smoke",
	]) {
		assert.match(readme, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
});

test("external calibration docs avoid submission-specific wording", () => {
	const calibrationDocs = [
		"docs/EXTERNAL_CONSUMER_CALIBRATION.md",
		"docs/POC_VALIDATION_PRESSURE.md",
		"docs/VAULT_SEED_CONVERGENCE.md",
		"docs/daily-driver-readiness.md",
	];
	const forbidden = [
		/Serpro/i,
		/Pr[eê]mio/i,
		/\bprize\b/i,
		/job-vault/i,
		/C:\\\\Users\\\\/i,
		/GitHub\\\\/i,
		/\b3[ºª]\b/i,
	];

	for (const file of calibrationDocs) {
		const contents = read(file);
		for (const pattern of forbidden) {
			assert.doesNotMatch(contents, pattern, `${file} contains ${pattern}`);
		}
	}
});

test("external calibration docs declare inventory-only evidence handling", () => {
	const pressure = read("docs/POC_VALIDATION_PRESSURE.md");
	const convergence = read("docs/VAULT_SEED_CONVERGENCE.md");

	assert.match(pressure, /repository shape and file\s+inventory as evidence/i);
	assert.match(pressure, /draft prose,\s+private local paths,\s+and submission wording stay outside Refarm/i);
	assert.match(convergence, /filenames are enough pressure signal/i);
	assert.match(convergence, /should not ingest or quote the draft bodies/i);
});

test("convergence docs keep apps as thin block consumers", () => {
	const convergence = read("docs/VAULT_SEED_CONVERGENCE.md");

	assert.match(convergence, /Do not duplicate the `dgk` product CLI in `apps\/refarm`/);
	assert.match(convergence, /without centralizing every workflow in `apps\/refarm`/);
	assert.match(convergence, /`apps\/refarm` accretes logic that should be a reusable block/);
	assert.match(convergence, /the apps\s+should be thin consumers that prove the blocks/i);
	assert.match(convergence, /package, package subpath, plugin, checked-in policy\/contract, or downstream\s+consumer bridge/i);
	assert.match(convergence, /reusable capability\s+belongs outside the app boundary/i);
});

test("ecosystem supply map keeps reference driver package-first", () => {
	const supplyMap = read("docs/ECOSYSTEM_SUPPLY_MAP.md");

	assert.match(supplyMap, /Reference agent driver/);
	assert.match(supplyMap, /@refarm\.dev\/cli\/capability-index/);
	assert.match(supplyMap, /@refarm\.dev\/cli\/interaction-driver/);
	assert.match(supplyMap, /@refarm\.dev\/cli\/worker-profile/);
	assert.match(supplyMap, /@refarm\.dev\/pi-agent` held/);
	assert.match(supplyMap, /Consumers keep their own command labels and product UX/);
	assert.match(supplyMap, /The\s+`runtime-agent`\/`pi-agent` execution package remains private/);
	assert.doesNotMatch(supplyMap, /reference-driver.*apps\/refarm/i);
});

test("superseded homestead ssr docs stay non-executable", () => {
	const spec = read("specs/features/2026-06-25-homestead-ssr-tier.md");
	const plan = read("docs/superpowers/plans/2026-06-25-homestead-ssr-tier.md");
	const runbook = read("docs/CONVERGENCE_EXECUTION_RUNBOOK.md");

	for (const document of [spec, plan]) {
		assert.match(document, /Superseded by ADR-072/);
		assert.match(document, /@refarm\.dev\/ds\/html/);
		assert.match(document, /Do not (implement|execute|create)/i);
		assert.doesNotMatch(document, /Task 1: Leaf render helpers/);
		assert.doesNotMatch(document, /pnpm --filter @refarm\.dev\/homestead-ssr pack/);
		assert.doesNotMatch(document, /Branch: `feat\/homestead-ssr-tier`/);
	}

	assert.match(runbook, /Item 4b\s+— superseded by `@refarm\.dev\/ds\/html`/);
	assert.doesNotMatch(runbook, /Branch: `feat\/homestead-ssr-tier`/);
	assert.doesNotMatch(runbook, /vault-seed` `serve\.js` rebuilt on the tier/);
});

test("release policy keeps SDK primitives behind explicit audience boundaries", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const profiles = config.releasePolicy.packageProfiles;
	const sdkProfiles = profiles.filter((profile) =>
		profile.tags?.includes("sdk-primitive"),
	);

	assert.ok(sdkProfiles.length > 0, "expected at least one sdk-primitive profile");

	for (const profile of sdkProfiles) {
		assert.ok(
			profile.tags.includes("boundary-review"),
			`${profile.id} must declare boundary-review before publication`,
		);
		assert.ok(
			!profile.tags.includes("vault-seed-ready") ||
				profile.tags.includes("consumer-pulled"),
			`${profile.id} must not enter vault-seed-ready without consumer-pulled proof`,
		);
	}
});

test("vault-seed-ready packages declare consumer-pulled intent", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const policy = config.releasePolicy;
	const selection = policy.selections.find((item) => item.id === "vault-seed-ready");
	assert.deepEqual(selection.audienceBoundary, {
		consumer: "vault-seed",
		naming: "product-neutral-sdk",
		productLocal:
			"Vault-specific CLI labels, copy, notebooks, routes, and UX stay downstream-owned.",
	});

	const profiles = policy.packageProfiles;
	const readyProfiles = profiles.filter((profile) =>
		profile.tags?.includes("vault-seed-ready"),
	);

	assert.ok(readyProfiles.length > 0, "expected vault-seed-ready profiles");

	for (const profile of readyProfiles) {
		assert.ok(
			profile.tags.includes("consumer-pulled"),
			`${profile.id} must declare consumer-pulled before entering vault-seed-ready`,
		);
	}
});

test("process handoff stays the selected process leaf", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const policyText = read("refarm.config.json");
	const selected = config.releasePolicy.packageProfiles
		.filter((profile) => profile.tags?.includes("vault-seed-ready"))
		.map((profile) => profile.id);

	assert.ok(selected.includes("@refarm.dev/process-handoff"));
	assert.ok(!selected.includes("@refarm.dev/launch-process"));
	assert.ok(!selected.includes("@refarm.dev/cli"));
	assert.doesNotMatch(policyText, /@refarm\.dev\/launch-process/);
});

test("source librarian adapters stay profiled but consumer-gated", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const policyText = read("refarm.config.json");
	const profiles = config.releasePolicy.packageProfiles;
	const byId = new Map(profiles.map((profile) => [profile.id, profile]));
	const vaultSeedReady = new Set(
		profiles
			.filter((profile) => profile.tags?.includes("vault-seed-ready"))
			.map((profile) => profile.id),
	);

	for (const packageName of [
		"@refarm.dev/source-contract-v1",
		"@refarm.dev/source-git",
		"@refarm.dev/source-local",
	]) {
		const profile = byId.get(packageName);
		assert.ok(profile, `${packageName} must be release-profiled`);
		assert.ok(
			profile.tags.includes("librarian"),
			`${packageName} must declare librarian scope`,
		);
		assert.ok(
			profile.tags.includes("boundary-review"),
			`${packageName} must stay boundary-reviewed`,
		);
		assert.ok(
			profile.tags.includes("candidate-hold"),
			`${packageName} must stay held until pulled`,
		);
		assert.ok(
			!vaultSeedReady.has(packageName),
			`${packageName} must not enter vault-seed-ready without downstream proof`,
		);
	}

	assert.doesNotMatch(policyText, /@refarm\.dev\/source-dispatch/);
});

test("release-engine docs keep host integration product-neutral", () => {
	const roadmap = read("packages/release-engine/ROADMAP.md");
	const readme = read("packages/release-engine/README.md");

	assert.doesNotMatch(roadmap, /controle de release por vault/i);
	assert.doesNotMatch(readme, /fonte local do reposit[oó]rio Refarm/i);
	assert.doesNotMatch(readme, /plano operacional via Refarm/i);
	assert.doesNotMatch(readme, /nomes internos do Refarm/i);
	assert.match(roadmap, /host\/control-plane consumidor/);
	assert.match(readme, /host\/control-plane consumidor/);
	assert.match(readme, /incluindo `apps\/refarm`/);
});

test("vault-seed-ready README openings stay consumer-neutral", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const profiles = config.releasePolicy.packageProfiles.filter((profile) =>
		profile.tags?.includes("vault-seed-ready"),
	);
	const forbiddenOpening = [
		/\bRefarm platform\b/,
		/\bRefarm consumers\b/,
		/\bRefarm and consumer CLIs\b/,
		/\bRefarm's sovereign cryptographic core\b/,
		/\bused by `refarm` and `farmhand`\b/i,
		/@refarm\.dev\/launch-process/,
	];

	for (const profile of profiles) {
		const packageDir = profile.id.replace("@refarm.dev/", "");
		const readme = read(`packages/${packageDir}/README.md`);
		const opening = readme.split("\n## ")[0];

		for (const pattern of forbiddenOpening) {
			assert.doesNotMatch(
				opening,
				pattern,
				`${profile.id} README opening should describe reusable capability, not Refarm-only positioning`,
			);
		}
	}
});

test("vault-seed-ready package descriptions stay consumer-neutral", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const forbiddenDescriptions = [
		/\bRefarm-powered\b/i,
		/\bRefarm platform\b/i,
		/\bRefarm consumers\b/i,
		/\bRefarm and consumer CLIs\b/i,
		/\bRefarm's\b/i,
		/@refarm\.dev\/launch-process/,
	];

	for (const profile of config.releasePolicy.packageProfiles.filter((candidate) =>
		candidate.tags?.includes("vault-seed-ready"),
	)) {
		const packageDir = profile.id.replace("@refarm.dev/", "");
		const packageJson = JSON.parse(read(`packages/${packageDir}/package.json`));
		const description = packageJson.description || "";

		for (const pattern of forbiddenDescriptions) {
			assert.doesNotMatch(
				description,
				pattern,
				`${profile.id} package description should describe reusable capability, not Refarm-only positioning`,
			);
		}
	}
});

test("vault-seed-ready README openings promote selected packages, not compatibility subpaths", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const selectedPackageNames = new Set(
		config.releasePolicy.packageProfiles
			.filter((profile) => profile.tags?.includes("vault-seed-ready"))
			.map((profile) => profile.id),
	);
	const forbiddenCompatibilitySubpaths = [
		{
			pattern: /@refarm\.dev\/cli\/process-handoff/,
			requiredPackage: "@refarm.dev/cli",
		},
		{
			pattern: /@refarm\.dev\/homestead\/ssr/,
			requiredPackage: "@refarm.dev/homestead",
		},
	];

	for (const profile of config.releasePolicy.packageProfiles.filter((candidate) =>
		candidate.tags?.includes("vault-seed-ready"),
	)) {
		const packageDir = profile.id.replace("@refarm.dev/", "");
		const readme = read(`packages/${packageDir}/README.md`);
		const opening = readme.split("\n## ")[0];

		for (const { pattern, requiredPackage } of forbiddenCompatibilitySubpaths) {
			if (!selectedPackageNames.has(requiredPackage)) {
				assert.doesNotMatch(
					opening,
					pattern,
					`${profile.id} README opening should promote its selected leaf package instead of ${requiredPackage} compatibility subpaths`,
				);
			}
		}
	}
});

test("vault-seed-ready README bodies avoid Refarm-owned capability wording", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const forbiddenCapabilityOwnership = [
		/\bRefarm owns\b/,
		/\bThis lets Refarm\b/,
		/\bexisting Refarm app surfaces\b/i,
		/\bcurrent Refarm apps\b/i,
		/\bconsumer CLIs to adopt Refarm\b/i,
		/\bRefarm operators can still\b/i,
	];

	for (const profile of config.releasePolicy.packageProfiles.filter((candidate) =>
		candidate.tags?.includes("vault-seed-ready"),
	)) {
		const packageDir = profile.id.replace("@refarm.dev/", "");
		const readme = read(`packages/${packageDir}/README.md`);

		for (const pattern of forbiddenCapabilityOwnership) {
			assert.doesNotMatch(
				readme,
				pattern,
				`${profile.id} README should describe package/host ownership instead of Refarm-owned capability wording`,
			);
		}
	}
});
