import { test, expect } from "vitest";
import fs from "node:fs";
import { join, dirname } from "node:path";
import os from "node:os";
import matter from "gray-matter";
import localHelper from "./local-helper";
import __refarmJsonModule0 from "../.site/vault-folders.json" with { type: "json" };
import sections from "./sidebar.sections.json" with { type: "json" };
const { folders: folderGroups } = __refarmJsonModule0;

test("cjs fixture", () => {
	const file = fs.readFileSync(join(import.meta.dirname, "x.md"), "utf8");
	expect(matter(file), "frontmatter parsed").toBeTruthy();
	expect(dirname(localHelper.path), "dirname matches home").toBe(os.homedir());
	expect(folderGroups).toEqual(sections);
});
