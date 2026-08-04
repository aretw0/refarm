import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemAuditor } from "./generic.js";

let rootDir;

function writeFile(relativePath, content = "") {
	const filePath = path.join(rootDir, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

describe("FileSystemAuditor", () => {
	it("matches a path at any depth with a leading **/ — and still matches nothing it should not", async () => {
		// A generated bindings file lives at packages/<any>/src/bindings.rs. Before `**/` was a
		// supported form, this pattern fell through to exact equality and quietly matched nothing,
		// so every WASM package added kept showing up as a finding.
		// Called unconditionally: a guard here would let the test pass by skipping itself.
		const matches = (value) =>
			FileSystemAuditor.__testMatchesPattern(value, "**/src/bindings.rs");
		expect(matches("packages/agent/src/bindings.rs")).toBe(true);
		expect(matches("src/bindings.rs")).toBe(true);
		expect(matches("packages/agent/src/other.rs")).toBe(false);
		expect(matches("packages/agent/generated/bindings.rs")).toBe(false);
	});

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-fs-"));
		// A real `git init`, not a bare `.git` directory: audit()'s project-base
		// gate below shells out to `git rev-parse`, which (correctly) does not
		// treat an empty `.git` folder as a repository.
		execFileSync("git", ["init", "--quiet"], { cwd: rootDir });
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("reports ignored source files unless policy excludes their pattern", async () => {
		writeFile(".gitignore", "*.generated.ts\n");
		writeFile("src/generated.generated.ts");
		writeFile("src/handwritten.ts");

		const auditor = new FileSystemAuditor();
		await expect(auditor.checkGitVisibility(rootDir, rootDir)).resolves.toEqual([
			{
				file: "src/generated.generated.ts",
				type: "git_ignored",
				path: path.join(rootDir, "src/generated.generated.ts"),
			},
		]);

		const policyAuditor = new FileSystemAuditor({
			ignoredGitVisibilityPatterns: ["**/*.generated.ts"],
		});
		await expect(policyAuditor.checkGitVisibility(rootDir, rootDir)).resolves.toEqual([]);
	});

	it("reports a typed issue instead of a silent empty pass when the scan cannot complete", async () => {
		// isomorphic-git's isIgnored throws a RangeError when the filepath it is
		// given escapes `dir` (a path.relative(rootDir, file) starting with
		// "..") — the real condition that used to be caught, logged to
		// console.error only, and folded into whatever `issues` had collected
		// so far. Passing a targetPath NOT nested under rootDir reproduces that
		// throw without any mocking.
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-outside-"));
		try {
			fs.writeFileSync(path.join(outsideDir, "sibling.ts"), "", "utf-8");

			const auditor = new FileSystemAuditor();
			const issues = await auditor.checkGitVisibility(rootDir, outsideDir);

			expect(issues).toEqual([
				expect.objectContaining({ type: "git_visibility_unreachable", path: outsideDir }),
			]);
		} finally {
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("supports exact ignored git visibility paths", async () => {
		writeFile(".gitignore", "src/bindings.rs\n");
		writeFile("src/bindings.rs");

		const auditor = new FileSystemAuditor({
			ignoredGitVisibilityPatterns: ["src/bindings.rs"],
		});

		await expect(auditor.checkGitVisibility(rootDir, rootDir)).resolves.toEqual([]);
	});

	describe("audit() — project-base applicability", () => {
		it("runs the git-visibility check normally when rootDir is a project (has .git)", async () => {
			// beforeEach already created rootDir/.git.
			writeFile(".gitignore", "src/generated.generated.ts\n");
			writeFile("src/generated.generated.ts");

			const auditor = new FileSystemAuditor();
			const result = await auditor.audit({ rootDir });

			expect(result.applicable).toBe(true);
			expect(result.reason).toBeUndefined();
			expect(result.git).toEqual([
				{
					file: "src/generated.generated.ts",
					type: "git_ignored",
					path: path.join(rootDir, "src/generated.generated.ts"),
				},
			]);
		});

		it("does NOT run the git-visibility check, and says why, when rootDir is not a project", async () => {
			// This is the measured defect this test guards against regressing: a
			// node base (no .git, no package.json) that happens to contain
			// unrelated git repositories as siblings must not have their ignored
			// files reported as findings against a repository it does not own.
			fs.rmSync(path.join(rootDir, ".git"), { recursive: true, force: true });
			const nestedRepoFile = path.join("git", "some-other-repo", "src", "generated.generated.ts");
			writeFile(nestedRepoFile);
			fs.mkdirSync(path.join(rootDir, "git", "some-other-repo", ".git"), { recursive: true });
			writeFile(path.join("git", "some-other-repo", ".gitignore"), "*.generated.ts\n");

			const auditor = new FileSystemAuditor();
			const result = await auditor.audit({ rootDir });

			expect(result.applicable).toBe(false);
			expect(result.reason).toContain(rootDir);
			expect(result.git).toEqual([]);
			// structure is still generic filesystem metadata, unaffected by applicability.
			expect(result.structure.isDirectory).toBe(true);
		});
	});
});
