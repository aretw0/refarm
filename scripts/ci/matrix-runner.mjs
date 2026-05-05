import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = join(__dirname, "../..");
const workspacePackages = JSON.parse(
	execSync("npm query .workspace", { cwd: ROOT_DIR }).toString(),
);

function findWorkspacePackage(pkgName) {
	const workspace = workspacePackages.find((pkg) => pkg.name === pkgName);
	if (!workspace?.path) {
		throw new Error(`Workspace package not found: ${pkgName}`);
	}
	return workspace;
}

function npmPackageExists(pkgName) {
	try {
		execSync(`npm view ${pkgName}@latest version --silent`, {
			cwd: ROOT_DIR,
			stdio: "pipe",
		});
		return true;
	} catch {
		return false;
	}
}

function localWorkspaceDependencyNames(pkg) {
	const dependencyBlocks = [
		pkg.dependencies ?? {},
		pkg.devDependencies ?? {},
		pkg.peerDependencies ?? {},
		pkg.optionalDependencies ?? {},
	];
	const workspaceNames = new Set(workspacePackages.map((entry) => entry.name));
	return [
		...new Set(
			dependencyBlocks
				.flatMap((deps) => Object.keys(deps))
				.filter((depName) => workspaceNames.has(depName)),
		),
	];
}

function rewriteWorkspaceDepsToLatest(packageJsonPath) {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	for (const blockName of [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	]) {
		const block = pkg[blockName];
		if (!block) continue;
		for (const depName of Object.keys(block)) {
			if (workspacePackages.some((entry) => entry.name === depName)) {
				block[depName] = "latest";
			}
		}
	}
	writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

// 1. Identify changed packages
function getChangedPackages() {
	try {
		const output = execSync(
			"npx turbo run test --filter=...[origin/main] --dry-run=json",
			{ cwd: ROOT_DIR },
		).toString();
		const turboData = JSON.parse(output);
		return (turboData.packages || []).filter((pkg) => pkg !== "//");
	} catch (err) {
		console.error("Failed to parse changed packages:", err);
		process.exit(1);
	}
}

// 2. Build the Matrix DAG
function buildMatrix(changed) {
	const matrix = { include: [] };
	const allWorkspacePackages = workspacePackages;

	for (const pkgName of changed) {
		if (
			pkgName.includes("eslint") ||
			pkgName.includes("tsconfig") ||
			pkgName.includes("manifest")
		)
			continue;

		matrix.include.push({
			strategy: "forward",
			package: pkgName,
			name: `Forward Reg: ${pkgName} (Local) w/ Published Deps`,
		});

		const dependents = allWorkspacePackages.filter((p) => {
			const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
			return Object.keys(deps).includes(pkgName);
		});

		for (const dependent of dependents) {
			matrix.include.push({
				strategy: "backward",
				package: pkgName,
				consumer: dependent.name,
				name: `Backward Reg: Published ${dependent.name} w/ Local ${pkgName}`,
			});
		}
	}
	return matrix;
}

// 3. Execution Engines (Agnostic Runners)
function runForward(pkgName) {
	console.log(`\n▶ Isolating ${pkgName} to test against NPM registry...`);
	const workspace = findWorkspacePackage(pkgName);
	const pkgDir = workspace.path;
	const unpublishedDeps = localWorkspaceDependencyNames(workspace).filter(
		(depName) => !npmPackageExists(depName),
	);
	if (unpublishedDeps.length > 0) {
		console.log(
			`⚠️  Skipping forward compat for ${pkgName}: unpublished workspace deps have no registry baseline (${unpublishedDeps.join(", ")}).`,
		);
		return;
	}
	try {
		// Replace local workspace dependencies with their published registry baseline.
		rewriteWorkspaceDepsToLatest(join(pkgDir, "package.json"));
		execSync("npm install --no-workspaces", { cwd: pkgDir, stdio: "inherit" });
		execSync("npm run test", { cwd: pkgDir, stdio: "inherit" });
		console.log(`✅ Forward compat passed for ${pkgName}`);
	} catch (err) {
		console.error(`❌ Forward compat failed for ${pkgName}`);
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	} finally {
		// Restore state using git
		execSync(`git checkout package.json`, { cwd: pkgDir });
		execSync(`npm install`, { cwd: ROOT_DIR });
	}
}

function runBackward(pkgName, consumerName) {
	console.log(
		`\n▶ Packing local ${pkgName} and injecting into published ${consumerName}...`,
	);
	if (!npmPackageExists(consumerName)) {
		console.log(
			`⚠️  Skipping backward compat for ${consumerName}: no published registry baseline.`,
		);
		return;
	}
	const pkgDir = findWorkspacePackage(pkgName).path;
	const consumerSlug = consumerName.replace(/^@/, "").replace(/[\\/]/g, "__");
	const testDir = join(ROOT_DIR, ".turbo", "matrix-test", consumerSlug);

	try {
		execSync("npm run build", { cwd: pkgDir, stdio: "inherit" });
		const tarOutput = execSync(`npm pack --pack-destination /tmp`, {
			cwd: pkgDir,
		})
			.toString()
			.trim();
		const tarballPath = join("/tmp", tarOutput);

		rmSync(testDir, { recursive: true, force: true });
		mkdirSync(testDir, { recursive: true });

		execSync("npm init -y", { cwd: testDir });
		// Install the published consumer
		execSync(`npm install ${consumerName}@latest --no-save`, {
			cwd: testDir,
			stdio: "inherit",
		});
		// Overwrite the specific child dependency with our local altered tarball
		execSync(`npm install ${tarballPath} --no-save`, {
			cwd: testDir,
			stdio: "inherit",
		});

		// Validate compilation (simulating consumer testing)
		execSync("npx tsc --noEmit", { cwd: testDir, stdio: "inherit" });
		console.log(
			`✅ Backward compat passed for ${consumerName} using local ${pkgName}`,
		);
	} catch (err) {
		console.error(
			`❌ Backward compat failed for ${consumerName} -> ${pkgName}`,
		);
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

// 4. CLI Router
const runMode = process.argv[2]; // e.g. "--execute", "--export-github"

if (runMode === "--execute") {
	const matrix = buildMatrix(getChangedPackages());
	console.log(
		`Executing ${matrix.include.length} matrix dimensions locally...`,
	);
	matrix.include.forEach((job) => {
		if (job.strategy === "forward") runForward(job.package);
		if (job.strategy === "backward") runBackward(job.package, job.consumer);
	});
	console.log("\n🎉 All Matrix Regressions Passed Agnosticamente!");
} else if (runMode === "--export-github") {
	const matrix = buildMatrix(getChangedPackages());
	if (process.env.GITHUB_OUTPUT) {
		execSync(
			`echo "matrix=${JSON.stringify(matrix).replace(/"/g, '\\"')}" >> $GITHUB_OUTPUT`,
		);
	} else {
		console.log(JSON.stringify(matrix));
	}
} else if (runMode === "--run-forward") {
	const pkg = process.argv[3];
	if (!pkg) throw new Error("Missing package argument for forward test");
	runForward(pkg);
} else if (runMode === "--run-backward") {
	const pkg = process.argv[3];
	const consumer = process.argv[4];
	if (!pkg || !consumer)
		throw new Error("Missing package or consumer argument for backward test");
	runBackward(pkg, consumer);
} else {
	console.log(
		"Please specify --execute, --export-github, --run-forward, or --run-backward.",
	);
}
