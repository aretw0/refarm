import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
	isOrganizableSourceFile,
	organizeImportText,
	uniqueSourceFiles,
} from "../organize-imports-lib.mjs";

describe("organize-imports-lib", () => {
	it("selects source files and skips generated artifacts", () => {
		assert.equal(isOrganizableSourceFile("apps/refarm/src/index.ts"), true);
		assert.equal(isOrganizableSourceFile("packages/config/src/index.js"), false);
		assert.equal(isOrganizableSourceFile("apps/refarm/dist/index.js"), false);
		assert.equal(isOrganizableSourceFile("packages/config/src/index.d.ts"), false);
		assert.deepEqual(
			uniqueSourceFiles([
				"apps/refarm/src/index.ts",
				"apps/refarm/src/index.ts",
				"apps/refarm/dist/index.js",
			], process.cwd()),
			["apps/refarm/src/index.ts"],
		);
	});

	it("uses the TypeScript language service to organize imports", () => {
		const root = mkdtempSync(path.join(tmpdir(), "refarm-organize-imports-"));
		const sourceDir = path.join(root, "src");
		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(path.join(sourceDir, "a.ts"), "export const a = 1;\n");
		writeFileSync(path.join(sourceDir, "b.ts"), "export const b = 2;\n");

		try {
			const input = [
				'import { describe,it } from "node:test";',
				'import { b } from "./b";',
				'import { a } from "./a";',
				'import { readFileSync } from "node:fs";',
				"",
				"console.log(a, b, describe, it);",
				"",
			].join("\n");
			const output = organizeImportText("src/main.ts", input, root);

			assert.equal(
				output,
				[
					'import { describe, it } from "node:test";',
					'import { a } from "./a";',
					'import { b } from "./b";',
					"",
					"console.log(a, b, describe, it);",
					"",
				].join("\n"),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps multiline export lists indented after organization", () => {
		const root = mkdtempSync(path.join(tmpdir(), "refarm-organize-imports-"));
		const sourceDir = path.join(root, "src");
		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(path.join(sourceDir, "a.ts"), "export const a = 1;\n");

		try {
			const input = [
				"export {",
				"b,",
				"a",
				'} from "./a";',
				"",
			].join("\n");
			const output = organizeImportText("src/main.ts", input, root);

			assert.equal(
				output,
				[
					"export {",
					"\tb,",
					"\ta",
					'} from "./a";',
					"",
				].join("\n"),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
