import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SITE_DATA = path.join(ROOT, "apps/site/src/site-data.ts");
const RECORDS_CONTEXT_ROUTE = path.join(
	ROOT,
	"apps/site/src/pages/contexts/records/v1.ts",
);
const CREDENTIALS_CONTEXT_ROUTE = path.join(
	ROOT,
	"apps/site/src/pages/contexts/credentials/v1.ts",
);
const RELEASE_OUTPUT_SCHEMA_ROUTE = path.join(
	ROOT,
	"apps/site/src/pages/schemas/release-output.schema.json.ts",
);
const RELEASE_POLICY_SCHEMA_ROUTE = path.join(
	ROOT,
	"apps/site/src/pages/schemas/release-policy.schema.json.ts",
);

function read(relativePath) {
	return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
	return JSON.parse(read(relativePath));
}

function quotedValues(block) {
	return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function siteDataSource() {
	return readFileSync(SITE_DATA, "utf8");
}

async function loadRouteModule(relativePath) {
	const sourcePath = path.join(ROOT, relativePath);
	const { outputText } = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: sourcePath,
	});
	return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`);
}

async function routeJson(relativePath) {
	const route = await loadRouteModule(relativePath);
	const response = route.GET();
	assert.equal(response.headers.get("Content-Type"), "application/ld+json; charset=utf-8");
	return response.json();
}

function extractVaultSeedPackages(source) {
	const match = /export const vaultSeedPackages = \[([\s\S]*?)\] as const;/u.exec(source);
	assert.ok(match, "site-data.ts must export vaultSeedPackages");
	return quotedValues(match[1]).sort();
}

function extractSiteFacts(source) {
	const match = /export const siteFacts = \{([\s\S]*?)\} as const;/u.exec(source);
	assert.ok(match, "site-data.ts must export siteFacts");
	const block = match[1];
	return {
		handoffDate: requiredString(block, "handoffDate"),
		packageCount: requiredNumber(block, "packageCount"),
		requiredCheckCount: requiredNumber(block, "requiredCheckCount"),
		publicPublishCount: requiredNumber(block, "publicPublishCount"),
		manualApprovalRequired: requiredBoolean(block, "manualApprovalRequired"),
	};
}

function requiredString(block, key) {
	const match = new RegExp(`${key}: "([^"]+)"`, "u").exec(block);
	assert.ok(match, `siteFacts.${key} must be a string literal`);
	return match[1];
}

function requiredNumber(block, key) {
	const match = new RegExp(`${key}: ([0-9]+)`, "u").exec(block);
	assert.ok(match, `siteFacts.${key} must be a number literal`);
	return Number(match[1]);
}

function requiredBoolean(block, key) {
	const match = new RegExp(`${key}: (true|false)`, "u").exec(block);
	assert.ok(match, `siteFacts.${key} must be a boolean literal`);
	return match[1] === "true";
}

function vaultSeedReadyFromConfig() {
	const config = readJson("refarm.config.json");
	return config.releasePolicy.packageProfiles
		.filter((profile) => profile.tags?.includes("vault-seed-ready"))
		.map((profile) => profile.id.replace(/^@refarm\.dev\//u, ""))
		.sort();
}

test("public site vault-seed-ready list follows release policy and handoff facts", () => {
	const source = siteDataSource();
	const sitePackages = extractVaultSeedPackages(source);
	const facts = extractSiteFacts(source);
	const handoffRelativePath = `.refarm/handoff/vault-seed/${facts.handoffDate}/manifest.json`;
	const handoff = readJson(handoffRelativePath);
	const handoffPackages = handoff.packages
		.map((entry) => entry.packageName.replace(/^@refarm\.dev\//u, ""))
		.sort();

	assert.deepEqual(sitePackages, vaultSeedReadyFromConfig());
	assert.deepEqual(sitePackages, handoffPackages);
	assert.equal(existsSync(path.join(ROOT, handoffRelativePath)), true);
	assert.equal(facts.packageCount, sitePackages.length);
	assert.equal(facts.packageCount, handoff.acceptance.packageCount);
	assert.equal(facts.requiredCheckCount, handoff.acceptance.requiredCheckCount);
	assert.equal(facts.manualApprovalRequired, handoff.acceptance.manualApprovalRequired);
	assert.equal(facts.publicPublishCount, 0);
	assert.equal(handoff.status, "ready");
	assert.equal(handoff.acceptance.status, "accepted");
});

test("public site serves the records:v1 JSON-LD context route", async () => {
	const source = readFileSync(RECORDS_CONTEXT_ROUTE, "utf8");
	const document = await routeJson("apps/site/src/pages/contexts/records/v1.ts");
	const context = document["@context"];

	assert.match(source, /export const prerender = true/);
	assert.equal(context["@version"], 1.1);
	assert.equal(context["@vocab"], "https://refarm.dev/contexts/records/v1#");
	assert.equal(context.KnowledgeRecord, "https://refarm.dev/contexts/records/v1#KnowledgeRecord");
	assert.equal(context.Requirement, "https://refarm.dev/contexts/records/v1#Requirement");
	assert.equal(context.Source, "https://refarm.dev/contexts/records/v1#Source");
	assert.equal(context.manifestVersion, "https://refarm.dev/contexts/records/v1#manifestVersion");
	assert.equal(context.records, "https://refarm.dev/contexts/records/v1#records");
	assert.equal(context.schemaVersion, "https://refarm.dev/contexts/records/v1#schemaVersion");
	assert.equal(context.fields, "https://refarm.dev/contexts/records/v1#fields");
	assert.equal(context.contentHash, "https://refarm.dev/contexts/records/v1#contentHash");
	assert.equal(context.sourceKind, "https://refarm.dev/contexts/records/v1#sourceKind");
	assert.equal(context.sourceLocation, "https://refarm.dev/contexts/records/v1#sourceLocation");
	assert.equal(context.hash, "https://refarm.dev/contexts/records/v1#hash");
	assert.equal(context.at, "https://refarm.dev/contexts/records/v1#at");
	assert.deepEqual(context.sourceRefs, {
		"@container": "@set",
		"@id": "https://refarm.dev/contexts/records/v1#sourceRefs",
		"@type": "@id",
	});
	assert.deepEqual(context.target, {
		"@id": "https://refarm.dev/contexts/records/v1#target",
		"@type": "@id",
	});
});

test("public site serves the credentials:v1 JSON-LD context route", async () => {
	const source = readFileSync(CREDENTIALS_CONTEXT_ROUTE, "utf8");
	const document = await routeJson("apps/site/src/pages/contexts/credentials/v1.ts");
	const context = document["@context"];

	assert.match(source, /export const prerender = true/);
	assert.equal(context["@version"], 1.1);
	assert.equal(context.credentials, "https://refarm.dev/contexts/credentials/v1#");
	assert.equal(context.CredentialProof, "credentials:CredentialProof");
	assert.equal(context.CredentialVerificationPolicy, "credentials:CredentialVerificationPolicy");
	assert.equal(context.CredentialVerificationResult, "credentials:CredentialVerificationResult");
	assert.equal(context.RefarmConformanceCredential, "credentials:RefarmConformanceCredential");
	assert.deepEqual(context.trustedIssuers, {
		"@container": "@set",
		"@id": "credentials:trustedIssuers",
		"@type": "@id",
	});
	assert.deepEqual(context.verificationMethod, {
		"@id": "credentials:verificationMethod",
		"@type": "@id",
	});
});

test("public site serves release-engine JSON Schema routes from package sources", () => {
	const outputRoute = readFileSync(RELEASE_OUTPUT_SCHEMA_ROUTE, "utf8");
	const policyRoute = readFileSync(RELEASE_POLICY_SCHEMA_ROUTE, "utf8");
	const outputSchema = readJson("packages/release-engine/release-output.schema.json");
	const policySchema = readJson("packages/release-engine/release-policy.schema.json");

	assert.match(outputRoute, /export const prerender = true/);
	assert.match(outputRoute, /Content-Type": "application\/schema\+json; charset=utf-8"/);
	assert.match(outputRoute, /packages\/release-engine\/release-output\.schema\.json/);
	assert.match(policyRoute, /export const prerender = true/);
	assert.match(policyRoute, /Content-Type": "application\/schema\+json; charset=utf-8"/);
	assert.match(policyRoute, /packages\/release-engine\/release-policy\.schema\.json/);
	assert.equal(outputSchema.$id, "https://refarm.dev/schemas/release-output.schema.json");
	assert.equal(policySchema.$id, "https://refarm.dev/schemas/release-policy.schema.json");
});
