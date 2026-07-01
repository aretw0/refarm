const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { join, dirname } = require("node:path");
const os = require("node:os");
const matter = require("gray-matter");
const localHelper = require("./local-helper");
const { folders: folderGroups } = require("../.site/vault-folders.json");
const sections = require("./sidebar.sections.json");

test("cjs fixture", () => {
	const file = fs.readFileSync(join(__dirname, "x.md"), "utf8");
	assert.ok(matter(file), "frontmatter parsed");
	assert.equal(dirname(localHelper.path), os.homedir(), "dirname matches home");
	assert.deepEqual(folderGroups, sections);
});
