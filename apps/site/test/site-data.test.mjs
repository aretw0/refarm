import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

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

test("public site serves the records:v1 JSON-LD context route", () => {
	const source = readFileSync(RECORDS_CONTEXT_ROUTE, "utf8");

	assert.match(source, /export const prerender = true/);
	assert.match(source, /Content-Type": "application\/ld\+json; charset=utf-8"/);
	assert.match(source, /records: "https:\/\/refarm\.dev\/contexts\/records\/v1#"/);
	assert.match(source, /KnowledgeRecord: "records:KnowledgeRecord"/);
	assert.match(source, /Requirement: "records:Requirement"/);
	assert.match(source, /schemaVersion: "records:schemaVersion"/);
	assert.match(source, /sourceRefs/);
	assert.match(source, /"@type": "@id"/);
});

test("public site serves the credentials:v1 JSON-LD context route", () => {
	const source = readFileSync(CREDENTIALS_CONTEXT_ROUTE, "utf8");

	assert.match(source, /export const prerender = true/);
	assert.match(source, /Content-Type": "application\/ld\+json; charset=utf-8"/);
	assert.match(source, /credentials: "https:\/\/refarm\.dev\/contexts\/credentials\/v1#"/);
	assert.match(source, /CredentialProof: "credentials:CredentialProof"/);
	assert.match(source, /CredentialVerificationPolicy: "credentials:CredentialVerificationPolicy"/);
	assert.match(source, /CredentialVerificationResult: "credentials:CredentialVerificationResult"/);
	assert.match(source, /RefarmConformanceCredential: "credentials:RefarmConformanceCredential"/);
	assert.match(source, /trustedIssuers/);
	assert.match(source, /verificationMethod/);
	assert.match(source, /"@type": "@id"/);
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
