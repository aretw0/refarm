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
	const adr = read("specs/ADRs/ADR-073-capability-index-incubation-boundary.md");
	const decisionLog = read("docs/decision-log.md");

	assert.match(supplyMap, /Reference agent driver/);
	assert.match(supplyMap, /@refarm\.dev\/cli\/capability-index/);
	assert.match(supplyMap, /@refarm\.dev\/cli\/interaction-driver/);
	assert.match(supplyMap, /@refarm\.dev\/cli\/worker-profile/);
	assert.match(supplyMap, /@refarm\.dev\/pi-agent` held/);
	assert.match(supplyMap, /refarm capabilities --supply-preflight\s+reference-driver --json/);
	assert.match(supplyMap, /adoptionCriteria/);
	assert.match(supplyMap, /promotionProofTargets/);
	assert.match(supplyMap, /budgetContract/);
	assert.match(supplyMap, /proofSummary/);
	assert.match(supplyMap, /cheap\s+promotion ledger/);
	assert.match(supplyMap, /promotionQueue/);
	assert.match(supplyMap, /candidate,\s+internal,\s+then hold/);
	assert.match(supplyMap, /publicationBoundary/);
	assert.match(supplyMap, /@refarm\.dev\/cli`\s+remains in\s+`boundary-review`/);
	assert.match(supplyMap, /not a\s+`vault-seed-ready`\s+leaf/);
	assert.match(supplyMap, /package-owned by\s+`@refarm\.dev\/cli\/capability-index`/);
	assert.match(supplyMap, /[Pp]reflight is for\s+release posture and consumer\s+planning/);
	assert.match(supplyMap, /worker\s+isolation/i);
	assert.match(supplyMap, /gateway\s+parity/i);
	assert.match(supplyMap, /budget\/observability/i);
	assert.match(supplyMap, /supply\/readiness index/);
	assert.match(supplyMap, /not Barn's\s+plugin catalog/);
	assert.match(supplyMap, /plugin-declared\s+`capabilities\.provides`\s+\/\s+`capabilities\.requires`/);
	assert.match(supplyMap, /installed plugin inventory, cache, and SHA-256 integrity/);
	assert.match(supplyMap, /capability registry,\s*supply\/readiness index,\s+and downstream assimilation map/);
	assert.match(supplyMap, /second non-CLI consumer/);
	assert.match(adr, /incubating operator\/discovery surface/);
	assert.match(adr, /Capability registry/);
	assert.match(adr, /Supply\/readiness index/);
	assert.match(adr, /Assimilation map/);
	assert.match(adr, /`@refarm\.dev\/cli\/capability-index` may continue to incubate/);
	assert.match(adr, /not a `vault-seed-ready` install leaf/);
	assert.match(adr, /`apps\/refarm`.*render or consume package-owned discovery data/s);
	assert.match(decisionLog, /Capability index incubation boundary/);
	assert.match(decisionLog, /second real non-CLI consumer/);
	assert.match(decisionLog, /`apps\/refarm` may render the data, but must not own capability truth/);
	assert.match(supplyMap, /Consumers keep their own command labels and product UX/);
	assert.match(supplyMap, /The\s+`runtime-agent`\/`pi-agent` execution package remains private/);
	assert.doesNotMatch(supplyMap, /reference-driver.*apps\/refarm/i);
});

test("factory readiness records hard environment ceilings", () => {
	const readiness = read("docs/CONVERGENCE_FACTORY_READINESS.md");

	assert.match(readiness, /environment citizenship/i);
	assert.match(readiness, /Environment Ceiling \/ Citizenship Rule/);
	assert.match(readiness, /hard to cross/);
	assert.match(readiness, /refuse with the next safe command, serialize the work, or degrade/);
	assert.match(readiness, /exit 137/);
	assert.match(readiness, /environment-pressure/);
	assert.match(readiness, /do not confuse abandoning a high-risk validation path/i);
	assert.match(readiness, /@refarm\.dev\/cli\/capability-index/);
	assert.match(readiness, /command\s+planning ceilings/);
});

test("work focus keeps adjacent tracks orbiting without premature product work", () => {
	const focus = read("docs/REFARM_WORK_FOCUS.md");
	const roadmap = read("docs/CONVERGENCE_ROADMAP.md");

	assert.match(focus, /Track orbit ledger/);
	assert.match(focus, /"Dormant" means gated by evidence, not abandoned/);

	assert.match(focus, /WASM substrate \/ Astro 7/);
	assert.match(focus, /Active as substrate, red as Astro-on-Tractor product adapter/);
	assert.match(focus, /ADR-070 Parts A\/B remain the lane/);
	assert.match(focus, /`wasm-surface:v1`, loader\/manifest policy/);
	assert.match(focus, /Reopening Astro SSR on Tractor as product work without a new upstream WASI profile or second-consumer proof/);
	assert.match(roadmap, /WASM substrate remains active, but Astro 7\/WASI Part C is closed red/);
	assert.match(roadmap, /Tractor native-first plus WASM-fallback posture/);

	assert.match(focus, /Native skills/);
	assert.match(focus, /not a second plugin ecosystem/);
	assert.match(focus, /plugin-manifest skill surface/);
	assert.match(focus, /outside Barn\/plugin policy/);

	assert.match(focus, /Distributed availability \/ Pears/);
	assert.match(focus, /runtime-adoption-gated/);
	assert.match(focus, /Adopting Bare\/Hypercore\/Pears wholesale/);

	assert.match(focus, /Remote workspace control/);
	assert.match(focus, /capability-scoped control/);
	assert.match(focus, /Treating mounts, host paths, Telegram, Matrix, or Tailscale as the core abstraction/);
});

test("remote workspace control horizon stays transport and app neutral", () => {
	const adr = read("specs/ADRs/ADR-074-remote-workspace-control-plane.md");
	const spec = read("specs/features/2026-06-30-remote-workspace-control-plane-proof.md");
	const plan = read("docs/superpowers/plans/2026-06-30-remote-workspace-control-plane-proof.md");
	const roadmap = read("docs/CONVERGENCE_ROADMAP.md");
	const readiness = read("docs/CONVERGENCE_FACTORY_READINESS.md");
	const decisionLog = read("docs/decision-log.md");

	assert.match(adr, /Remote Workspace Control Plane/);
	assert.match(adr, /transport-neutral/);
	assert.match(adr, /Tailscale.*not require it as the only transport/s);
	assert.match(adr, /Telegram or Matrix bridge is a channel adapter/);
	assert.match(adr, /No raw shell by default/);
	assert.match(adr, /Policy precedes execution/);
	assert.match(adr, /Environment ceilings are part of dispatch/);
	assert.match(adr, /Work policy is respected/);
	assert.match(adr, /Do not add remote execution directly to `apps\/refarm` as app-local logic/);
	assert.match(adr, /bounded read-only check/);
	assert.match(spec, /READY FOR FIRST PROOF/);
	assert.match(spec, /proof-local until a second consumer needs it as a stable SDK/);
	assert.match(spec, /process-handoff/);
	assert.match(spec, /stream-contract-v1/);
	assert.match(spec, /Do not extract a package yet/);
	assert.match(spec, /docs\/tests prove no Telegram\/Matrix\/Tailscale\/PWA\/Android\/app-specific/);
	assert.match(plan, /descriptor is not exported as a public package contract/);
	assert.match(plan, /no generic remote shell/);
	assert.match(plan, /Do not create `@refarm\.dev\/workspace-node-contract-v1`/);
	assert.match(roadmap, /Remote workspace control plane/);
	assert.match(roadmap, /PWA, Android, CLI, Telegram, Matrix/);
	assert.match(roadmap, /Tailscale is a strong private-network fixture, not the canonical protocol/);
	assert.match(roadmap, /first loopback proof implemented/);
	assert.match(readiness, /remote workspace control plane/);
	assert.match(readiness, /first proof implemented, not product-ready/);
	assert.match(readiness, /remote Refarm node must be allowed to refuse,\s+serialize, or degrade work/);
	assert.match(decisionLog, /Remote workspace control plane/);
	assert.match(decisionLog, /not a Telegram\/Matrix\/Tailscale-specific protocol/);
	assert.match(decisionLog, /Remote mutation and raw shell remain elevated/);
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

test("ds html active handoff docs use static document naming", () => {
	const activeDocs = [
		"packages/ds/README.md",
		"docs/DEV_CROSS_REPO_CONSUMPTION.md",
		"docs/VAULT_SEED_CONVERGENCE.md",
		"docs/v0.1.0-release-gate.md",
		"docs/ECOSYSTEM_SUPPLY_MAP.md",
		"scripts/vault-seed-ready-handoff.mjs",
	];
	const forbidden = [
		/\bshellHtml\b/,
		/\bShellOptions\b/,
		/html-shell/i,
		/HTML shell/i,
		/shell helpers/i,
		/render a `verde-jardim` shell/i,
		/DS HTML helpers/,
	];

	for (const file of activeDocs) {
		const contents = read(file);
		assert.match(
			contents,
			/documentHtml|static document|document helpers/,
			`${file} should expose ds/html as a static document helper`,
		);
		for (const pattern of forbidden) {
			assert.doesNotMatch(
				contents,
				pattern,
				`${file} should not reintroduce Homestead shell vocabulary for ds/html`,
			);
		}
	}
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

test("source librarian packages distinguish proven handoff leaves from held adapters", () => {
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
		"@refarm.dev/source-web",
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
	}

	for (const packageName of [
		"@refarm.dev/source-contract-v1",
		"@refarm.dev/source-web",
	]) {
		const profile = byId.get(packageName);
		for (const tag of ["consumer-pulled", "vault-seed-ready", "consumer-proven"]) {
			assert.ok(
				profile.tags.includes(tag),
				`${packageName} must declare ${tag} after selected downstream proof`,
			);
		}
		assert.ok(
			vaultSeedReady.has(packageName),
			`${packageName} must enter vault-seed-ready after selected downstream proof`,
		);
	}

	for (const packageName of ["@refarm.dev/source-git", "@refarm.dev/source-local"]) {
		const profile = byId.get(packageName);
		assert.ok(
			profile.tags.includes("candidate-hold"),
			`${packageName} must stay held until executable consumer proof`,
		);
		assert.ok(
			!vaultSeedReady.has(packageName),
			`${packageName} must not enter vault-seed-ready without selected downstream proof`,
		);
	}

	assert.doesNotMatch(policyText, /@refarm\.dev\/source-dispatch/);
});

test("requirements supply packages are selected only after downstream proof", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const profiles = config.releasePolicy.packageProfiles;
	const byId = new Map(profiles.map((profile) => [profile.id, profile]));
	const vaultSeedReady = new Set(
		profiles
			.filter((profile) => profile.tags?.includes("vault-seed-ready"))
			.map((profile) => profile.id),
	);

	for (const packageName of [
		"@refarm.dev/source-web",
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
	]) {
		const profile = byId.get(packageName);
		assert.ok(profile, `${packageName} must be release-profiled`);
		assert.ok(
			profile.tags.includes("requirements-supply"),
			`${packageName} must declare requirements-supply scope`,
		);
		assert.ok(
			profile.tags.includes("boundary-review"),
			`${packageName} must stay boundary-reviewed`,
		);
		for (const tag of ["consumer-pulled", "vault-seed-ready", "consumer-proven"]) {
			assert.ok(
				profile.tags.includes(tag),
				`${packageName} must declare ${tag} after selected downstream proof`,
			);
		}
		assert.ok(
			Array.isArray(profile.mustPassChecks) && profile.mustPassChecks.length >= 2,
			`${packageName} must declare package checks before handoff planning`,
		);
		assert.ok(
			vaultSeedReady.has(packageName),
			`${packageName} must enter vault-seed-ready after selected downstream proof`,
		);
	}

	assert.ok(
		byId
			.get("@refarm.dev/records-contract-v1")
			.mustPassChecks.includes("pnpm --filter @refarm.dev/records-contract-v1 run test:unit"),
		"records-contract-v1 release checks must include the YAML subpath unit proof",
	);
});

test("t2 identity credentials stay reference-profiled without release selection", () => {
	const config = JSON.parse(read("refarm.config.json"));
	const profiles = config.releasePolicy.packageProfiles;
	const byId = new Map(profiles.map((profile) => [profile.id, profile]));
	const vaultSeedReady = new Set(
		profiles
			.filter((profile) => profile.tags?.includes("vault-seed-ready"))
			.map((profile) => profile.id),
	);

	for (const packageName of [
		"@refarm.dev/identity-heartwood",
		"@refarm.dev/credentials-contract-v1",
	]) {
		const profile = byId.get(packageName);
		assert.ok(profile, `${packageName} must be release-profiled`);
		for (const tag of ["t2-reference", "reference-proven", "boundary-review", "reference-hold"]) {
			assert.ok(profile.tags.includes(tag), `${packageName} must declare ${tag}`);
		}
		for (const tag of ["candidate", "consumer-pulled", "vault-seed-ready"]) {
			assert.ok(!profile.tags.includes(tag), `${packageName} must not declare ${tag}`);
		}
		for (const command of [
			`pnpm --filter ${packageName} run lint`,
			`pnpm --filter ${packageName} run type-check`,
			`pnpm --filter ${packageName} run test:conformance`,
			`pnpm --filter ${packageName} run build`,
		]) {
			assert.ok(profile.mustPassChecks.includes(command), `${packageName} must require ${command}`);
		}
		assert.ok(
			!vaultSeedReady.has(packageName),
			`${packageName} must not enter vault-seed-ready without selected downstream proof`,
		);
	}

	assert.ok(
		byId
			.get("@refarm.dev/credentials-contract-v1")
			.mustPassChecks.includes("pnpm run sovereign-citizen:reference:test"),
		"credentials-contract-v1 must keep the sovereign citizen reference proof in release policy",
	);
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
