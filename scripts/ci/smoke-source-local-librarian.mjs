#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createLocalSourceProvider } from "@refarm.dev/source-local";

const root = process.env.SMOKE_SOURCE_LOCAL_ROOT
	? path.resolve(process.env.SMOKE_SOURCE_LOCAL_ROOT)
	: process.cwd();
const ref = `local:${root}`;
const provider = createLocalSourceProvider({ cwd: root });

const materialized = await provider.materialize(ref);
if (materialized.action !== "linked") {
	throw new Error(`expected source-local action 'linked', got '${materialized.action}'`);
}
if (materialized.location.path !== root) {
	throw new Error(`expected materialized path ${root}, got ${materialized.location.path}`);
}

const packageJsonPath = path.join(materialized.location.path, "package.json");
const packagesPath = path.join(materialized.location.path, "packages");
if (!existsSync(packageJsonPath)) {
	throw new Error(`expected package.json at ${packageJsonPath}`);
}
if (!existsSync(packagesPath)) {
	throw new Error(`expected packages directory at ${packagesPath}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
if (packageJson.name !== "refarm") {
	throw new Error(`expected root package name 'refarm', got '${packageJson.name}'`);
}

const status = await provider.status(ref);
if (!status.materialized || status.path !== root) {
	throw new Error("expected materialized source-local status for the Refarm workspace");
}

const state = status.clean === true
	? "clean"
	: status.dirty || status.untracked
		? "dirty-or-untracked"
		: "unknown";

console.log(
	`[librarian local smoke] OK - ${ref} linked at ${status.path} (${state}, head ${status.head ?? "none"})`,
);
