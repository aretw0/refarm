#!/usr/bin/env node

/**
 * Release Helper Script
 * 
 * Safely bump version and create tag for capability contract packages.
 * Usage: node scripts/release.mjs <package-name> <version-bump>
 * 
 * Example:
 *   node scripts/release.mjs storage-contract-v1 patch
 *   node scripts/release.mjs sync-contract-v1 minor
 *   node scripts/release.mjs identity-contract-v1 0.2.0
 */

import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "@refarm.dev/config";

const execAsync = promisify(exec);
const config = loadConfig();
const devScope = config.brand?.scopes?.dev || "@refarm.dev";
const repoUrl = config.brand?.urls?.repository?.replace(".git", "") || "https://github.com/refarm-dev/refarm";

const PACKAGES = [
  "storage-contract-v1",
  "sync-contract-v1",
  "identity-contract-v1",
  "plugin-manifest",
];

const ORG = devScope;

async function main() {
  const [, , packageName, versionBump] = process.argv;

  if (!packageName || !versionBump) {
    console.error("Usage: node scripts/release.mjs <package-name> <version-bump>");
    console.error("\nAvailable packages:");
    PACKAGES.forEach((pkg) => console.error(`  - ${pkg}`));
    console.error("\nVersion bump: patch | minor | major | 0.2.0 (specific version)");
    process.exit(1);
  }

  if (!PACKAGES.includes(packageName)) {
    console.error(`❌ Unknown package: ${packageName}`);
    console.error(`Available packages: ${PACKAGES.join(", ")}`);
    process.exit(1);
  }

  const packageDir = resolve(process.cwd(), "packages", packageName);
  const packageJsonPath = join(packageDir, "package.json");

  // Read current version
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
  const currentVersion = packageJson.version;
  const fullPackageName = packageJson.name;

  console.log(`\n📦 Releasing ${fullPackageName}`);
  console.log(`   Current version: ${currentVersion}`);

  // Check git status
  const { stdout: gitStatus } = await execAsync("git status --porcelain");
  if (gitStatus.trim()) {
    console.error("\n❌ Working directory is not clean. Commit or stash changes first.");
    console.error(gitStatus);
    process.exit(1);
  }

  // Bump version
  let newVersion;
  if (["patch", "minor", "major"].includes(versionBump)) {
    console.log(`   Bumping: ${versionBump}`);
    const { stdout } = await execAsync(`npm version ${versionBump} --no-git-tag-version`, {
      cwd: packageDir,
    });
    newVersion = stdout.trim().replace(/^v/, "");
  } else {
    // Specific version
    newVersion = versionBump.replace(/^v/, "");
    packageJson.version = newVersion;
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
    console.log(`   Setting version: ${newVersion}`);
  }

  const tagName = `${fullPackageName}@${newVersion}`;

  console.log(`\n✅ Version bumped: ${currentVersion} → ${newVersion}`);
  console.log(`   Tag: ${tagName}`);

  // Run validations
  console.log("\n🔍 Running validations...");

  try {
    console.log("   - Type checking...");
    await execAsync("npm run type-check", { cwd: packageDir });

    console.log("   - Building...");
    await execAsync("npm run build", { cwd: packageDir });

    console.log("   - Testing conformance...");
    await execAsync("npm run test:capabilities", { cwd: process.cwd() });

    console.log("   - Dry-run publish...");
    await execAsync("npm publish --dry-run", { cwd: packageDir });
  } catch (error) {
    console.error("\n❌ Validation failed:");
    console.error(error.stdout || error.stderr || error.message);
    
    // Rollback version bump
    packageJson.version = currentVersion;
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
    console.log("\n⏪ Rolled back version change");
    
    process.exit(1);
  }

  console.log("\n✅ All validations passed!");

  // Commit and tag
  console.log("\n📝 Creating commit and tag...");
  await execAsync(`git add ${packageJsonPath}`);
  await execAsync(`git commit -m "chore(${packageName}): release v${newVersion}"`);
  await execAsync(`git tag ${tagName}`);

  console.log(`\n🎉 Release prepared!`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review the changes: git show`);
  console.log(`  2. Push the tag to trigger CI/CD:`);
  console.log(`     git push origin ${tagName}`);
  console.log(`  3. Monitor the workflow:`);
  console.log(`     ${repoUrl}/actions`);
  console.log(`\nTo abort:`);
  console.log(`  git reset --hard HEAD~1`);
  console.log(`  git tag -d ${tagName}`);
}

main().catch((error) => {
  console.error("\n💥 Unexpected error:");
  console.error(error);
  process.exit(1);
});
