import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
	checkLocales,
	compareLocaleKeys,
	flattenKeys,
} from "../check-locales-lib.mjs";

function writeLocaleFixture(files) {
	const tempDir = mkdtempSync(path.join(tmpdir(), "refarm-locales-"));
	for (const [locale, content] of Object.entries(files)) {
		writeFileSync(
			path.join(tempDir, `${locale}.json`),
			`${JSON.stringify(content, null, 2)}\n`,
			"utf8",
		);
	}
	return tempDir;
}

describe("check-locales-lib", () => {
	it("flattens nested object keys and treats arrays as leaves", () => {
		assert.deepEqual(
			flattenKeys({
				common: { save: "Save", menu: ["File"] },
				status: "Ready",
			}).sort(),
			["common.menu", "common.save", "status"],
		);
	});

	it("reports missing and extra locale keys against the base locale", () => {
		const differences = compareLocaleKeys(
			{
				"pt-BR": new Set(["common.save", "common.cancel"]),
				en: new Set(["common.save", "common.extra"]),
				es: new Set(["common.save", "common.cancel"]),
			},
			["pt-BR", "en", "es"],
		);

		assert.deepEqual(differences, [
			{
				locale: "en",
				missingKeys: ["common.cancel"],
				extraKeys: ["common.extra"],
			},
		]);
	});

	it("checks locale files from an arbitrary directory", () => {
		const tempDir = writeLocaleFixture({
			"pt-BR": { common: { save: "Salvar" } },
			en: { common: { save: "Save" } },
		});

		try {
			assert.deepEqual(checkLocales(tempDir, ["pt-BR", "en"]), {
				baseLocale: "pt-BR",
				baseKeyCount: 1,
				differences: [],
				supportedLocales: ["pt-BR", "en"],
			});
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("fails when a supported locale file is missing", () => {
		const tempDir = writeLocaleFixture({
			"pt-BR": { common: { save: "Salvar" } },
		});

		try {
			assert.throws(
				() => checkLocales(tempDir, ["pt-BR", "en"]),
				/Missing locale file: en\.json/,
			);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
