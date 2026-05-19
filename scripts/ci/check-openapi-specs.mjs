#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SPECS_DIR = path.join(ROOT, "specs", "protocols");
const FARMHAND_SIDECAR_SPEC = path.join(
	SPECS_DIR,
	"http",
	"farmhand-sidecar.openapi.v1.json",
);

function collectJsonFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.flatMap((entry) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return collectJsonFiles(fullPath);
			return entry.isFile() && entry.name.endsWith(".openapi.v1.json")
				? [fullPath]
				: [];
		})
		.sort();
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function hasJsonPointer(document, ref) {
	if (!ref.startsWith("#/")) return false;
	let current = document;
	for (const rawPart of ref.slice(2).split("/")) {
		const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
		if (!current || typeof current !== "object" || !(part in current)) {
			return false;
		}
		current = current[part];
	}
	return true;
}

function visit(value, fn) {
	fn(value);
	if (Array.isArray(value)) {
		for (const item of value) visit(item, fn);
		return;
	}
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) visit(child, fn);
	}
}

function validateSpec(filePath) {
	const relativePath = path.relative(ROOT, filePath);
	const spec = JSON.parse(fs.readFileSync(filePath, "utf-8"));

	assert(spec.openapi === "3.1.0", `${relativePath}: expected openapi 3.1.0`);
	assert(spec.info?.title, `${relativePath}: missing info.title`);
	assert(spec.info?.version, `${relativePath}: missing info.version`);
	assert(spec.paths && typeof spec.paths === "object", `${relativePath}: missing paths`);

	const operationIds = new Set();
	for (const [route, pathItem] of Object.entries(spec.paths)) {
		assert(route.startsWith("/"), `${relativePath}: route must start with /: ${route}`);
		for (const [method, operation] of Object.entries(pathItem)) {
			if (!["get", "put", "post", "delete", "patch", "head", "options", "trace"].includes(method)) {
				continue;
			}
			assert(operation.operationId, `${relativePath}: ${method.toUpperCase()} ${route} missing operationId`);
			assert(!operationIds.has(operation.operationId), `${relativePath}: duplicate operationId ${operation.operationId}`);
			operationIds.add(operation.operationId);
			assert(operation.responses && typeof operation.responses === "object", `${relativePath}: ${operation.operationId} missing responses`);
		}
	}

	visit(spec, (node) => {
		if (!node || typeof node !== "object" || typeof node.$ref !== "string") return;
		assert(
			hasJsonPointer(spec, node.$ref),
			`${relativePath}: unresolved local ref ${node.$ref}`,
		);
	});
}

function normalizeOpenApiPath(route) {
	return route.replace(/\{([^}]+)\}/g, ":$1");
}

function implementedFarmhandSidecarRoutes() {
	return [
		["GET", "/efforts"],
		["POST", "/efforts"],
		["GET", "/efforts/summary"],
		["GET", "/efforts/:effortId"],
		["GET", "/efforts/:effortId/logs"],
		["POST", "/efforts/:effortId/retry"],
		["POST", "/efforts/:effortId/cancel"],
		["GET", "/sessions"],
		["POST", "/sessions"],
		["GET", "/telemetry"],
		["GET", "/telemetry/window"],
		["POST", "/plugins/install"],
		["POST", "/plugins/reload"],
		["GET", "/plugins/reload/status/:reloadId"],
	].map(([method, route]) => `${method} ${route}`);
}

function declaredRoutes(spec) {
	const methods = new Set(["get", "put", "post", "delete", "patch", "head", "options", "trace"]);
	const routes = [];
	for (const [route, pathItem] of Object.entries(spec.paths ?? {})) {
		for (const method of Object.keys(pathItem)) {
			if (!methods.has(method)) continue;
			routes.push(`${method.toUpperCase()} ${normalizeOpenApiPath(route)}`);
		}
	}
	return routes.sort();
}

function validateFarmhandSidecarRouteCoverage() {
	if (!fs.existsSync(FARMHAND_SIDECAR_SPEC)) return;
	const spec = JSON.parse(fs.readFileSync(FARMHAND_SIDECAR_SPEC, "utf-8"));
	const declared = new Set(declaredRoutes(spec));
	const implemented = implementedFarmhandSidecarRoutes();
	const missing = implemented.filter((route) => !declared.has(route));
	const extra = [...declared].filter((route) => !implemented.includes(route));
	assert(
		missing.length === 0,
		`farmhand sidecar OpenAPI missing implemented route(s): ${missing.join(", ")}`,
	);
	assert(
		extra.length === 0,
		`farmhand sidecar OpenAPI declares route(s) not in implementation inventory: ${extra.join(", ")}`,
	);
}

const files = collectJsonFiles(SPECS_DIR);
assert(files.length > 0, "No OpenAPI JSON specs found in specs/protocols");

for (const file of files) validateSpec(file);
validateFarmhandSidecarRouteCoverage();
console.log(`OpenAPI specs ok (${files.length})`);
