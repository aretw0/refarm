import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readLocalExtensionManifests } from "./plugin-shared.js";

describe("local extension surface manifests", () => {
	it("reads project and global ext.json files as surfaceable plugin manifests", () => {
		const cwd = mkdtempSync(path.join(os.tmpdir(), "refarm-local-ext-cwd-"));
		const home = mkdtempSync(path.join(os.tmpdir(), "refarm-local-ext-home-"));
		try {
			const projectExt = path.join(cwd, ".refarm", "extensions", "wallet");
			const globalExt = path.join(home, ".refarm", "extensions", "requirements");
			mkdirSync(projectExt, { recursive: true });
			mkdirSync(globalExt, { recursive: true });
			writeFileSync(
				path.join(projectExt, "ext.json"),
				JSON.stringify({
					id: "@local/wallet",
					name: "Wallet",
					version: "0.0.1",
					capabilities: {
						provides: ["wallet:open"],
						subscribes: ["wallet:dispatch"],
					},
				}),
			);
			writeFileSync(
				path.join(globalExt, "ext.json"),
				JSON.stringify({
					id: "@local/requirements",
					name: "Requirements",
					version: "0.0.1",
					capabilities: {
						provides: ["requirements:open"],
						subscribes: ["requirements:dispatch"],
					},
				}),
			);

			expect(readLocalExtensionManifests(cwd, home)).toEqual([
				{
					id: "@local/wallet",
					capabilities: {
						provides: ["wallet:open"],
						subscribes: ["wallet:dispatch"],
					},
				},
				{
					id: "@local/requirements",
					capabilities: {
						provides: ["requirements:open"],
						subscribes: ["requirements:dispatch"],
					},
				},
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});
});
