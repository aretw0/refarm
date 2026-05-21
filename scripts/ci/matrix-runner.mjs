import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectPackageManager,
	packageBinaryCommand,
	packageInstallCommand,
	packageScriptCommand,
} from "../../packages/config/src/package-manager.js";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = join(__dirname, "../..");
const workspacePackages = JSON.parse(
	execSync("pnpm ls -r --json --depth 0", {
		cwd: ROOT_DIR,
		maxBuffer: 20 * 1024 * 1024,
	}).toString(),
);

function packageManager() {
	return detectPackageManager({ cwd: ROOT_DIR });
}

function installCommand() {
	const base = packageInstallCommand({ cwd: ROOT_DIR });
	const args = base.command.split(" ");
	switch (base.packageManager) {
		case "pnpm":
			args.push("--no-frozen-lockfile");
			break;
		case "npm":
			args.push("--package-lock=false");
			break;
		case "yarn":
			args.push("--no-immutable");
			break;
	}
	return args.join(" ");
}

function scriptCommand(script) {
	return packageScriptCommand(script, { cwd: ROOT_DIR }).command;
}

function packCommand() {
	switch (packageManager()) {
		case "pnpm":
			return "pnpm pack --pack-destination /tmp";
		case "npm":
			return "npm pack --pack-destination /tmp";
		case "yarn":
			return "yarn pack --out /tmp/package.tgz";
		case "bun":
			return "bun pm pack --destination /tmp";
		default:
			throw new Error(`Unsupported package manager: ${packageManager()}`);
	}
}

function initCommand() {
	switch (packageManager()) {
		case "pnpm":
			return "pnpm init";
		case "npm":
			return "npm init -y";
		case "yarn":
			return "yarn init -y";
		case "bun":
			return "bun init -y";
		default:
			throw new Error(`Unsupported package manager: ${packageManager()}`);
	}
}

function addCommand(spec) {
	switch (packageManager()) {
		case "pnpm":
			return `pnpm add ${spec}`;
		case "npm":
			return `npm install ${spec}`;
		case "yarn":
			return `yarn add ${spec}`;
		case "bun":
			return `bun add ${spec}`;
		default:
			throw new Error(`Unsupported package manager: ${packageManager()}`);
	}
}

function typeScriptCheckCommand() {
	const tsc = packageBinaryCommand("tsc", ["--noEmit"], { cwd: ROOT_DIR });
	return `${tsc.command} ${tsc.args.join(" ")}`;
}

function findWorkspacePackage(pkgName) {
	const workspace = workspacePackages.find((pkg) => pkg.name === pkgName);
	if (!workspace?.path) {
		throw new Error(`Workspace package not found: ${pkgName}`);
	}
	return workspace;
}

function registryViewCommand(pkgName) {
	switch (packageManager()) {
		case "pnpm":
			return `pnpm view ${pkgName}@latest version --silent`;
		case "npm":
			return `npm view ${pkgName}@latest version --silent`;
		case "yarn":
			return `yarn npm info ${pkgName}@latest version`;
		case "bun":
			return `bun pm view ${pkgName}@latest version`;
		default:
			throw new Error(`Unsupported package manager: ${packageManager()}`);
	}
}

function registryPackageExists(pkgName) {
	try {
		execSync(registryViewCommand(pkgName), {
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

function pickValidationScript(pkg) {
	const scripts = pkg.scripts ?? {};
	for (const scriptName of [
		"test:prepush",
		"test:unit",
		"test",
		"type-check",
		"build",
	]) {
		if (scripts[scriptName]) return scriptName;
	}
	return undefined;
}

// 1. Identify changed packages
function getChangedPackages() {
	try {
		const turbo = packageBinaryCommand(
			"turbo",
			["run", "test", "--filter=...[origin/main]", "--dry-run=json"],
			{ cwd: ROOT_DIR },
		);
		const output = execSync(`${turbo.command} ${turbo.args.join(" ")}`, {
			cwd: ROOT_DIR,
		}).toString();
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
		(depName) => !registryPackageExists(depName),
	);
	if (unpublishedDeps.length > 0) {
		console.log(
			`⚠️  Skipping forward compat for ${pkgName}: unpublished workspace deps have no registry baseline (${unpublishedDeps.join(", ")}).`,
		);
		return;
	}
	const validationScript = pickValidationScript(workspace);
	if (!validationScript) {
		console.log(
			`⚠️  Skipping forward compat for ${pkgName}: no test/type-check/build script declared.`,
		);
		return;
	}
	// Copy package to an isolated dir outside the workspace so the package manager treats it
	// as a standalone project and resolves all deps from the registry.
	// In-place mutation of package.json inside the workspace is fragile:
	// package managers create lockfiles and node_modules/ that git restore misses.
	const slug = pkgName.replace(/[@/]/g, "__");
	const testDir = `/tmp/refarm-forward-compat/${slug}`;
	try {
		rmSync(testDir, { recursive: true, force: true });
		cpSync(pkgDir, testDir, { recursive: true });
		for (const artifact of ["node_modules", "dist", ".turbo"]) {
			rmSync(join(testDir, artifact), { recursive: true, force: true });
		}
		rewriteWorkspaceDepsToLatest(join(testDir, "package.json"));
		execSync(installCommand(), {
			cwd: testDir,
			stdio: "inherit",
		});
		execSync(scriptCommand(validationScript), {
			cwd: testDir,
			stdio: "inherit",
		});
		console.log(
			`✅ Forward compat passed for ${pkgName} (${validationScript})`,
		);
	} catch (err) {
		console.error(`❌ Forward compat failed for ${pkgName}`);
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	} finally {
		rmSync(testDir, { recursive: true, force: true });
	}
}

function runBackward(pkgName, consumerName) {
	console.log(
		`\n▶ Packing local ${pkgName} and injecting into published ${consumerName}...`,
	);
	if (!registryPackageExists(consumerName)) {
		console.log(
			`⚠️  Skipping backward compat for ${consumerName}: no published registry baseline.`,
		);
		return;
	}
	const pkgDir = findWorkspacePackage(pkgName).path;
	const consumerSlug = consumerName.replace(/^@/, "").replace(/[\\/]/g, "__");
	const testDir = join(ROOT_DIR, ".turbo", "matrix-test", consumerSlug);

	try {
		execSync(scriptCommand("build"), { cwd: pkgDir, stdio: "inherit" });
		const tarOutput = execSync(packCommand(), {
			cwd: pkgDir,
		})
			.toString()
			.trim();
		const tarballPath = join("/tmp", tarOutput);

		rmSync(testDir, { recursive: true, force: true });
		mkdirSync(testDir, { recursive: true });

		execSync(initCommand(), { cwd: testDir });
		// Install the published consumer
		execSync(addCommand(`${consumerName}@latest`), {
			cwd: testDir,
			stdio: "inherit",
		});
		// Overwrite the specific child dependency with our local altered tarball
		execSync(addCommand(tarballPath), {
			cwd: testDir,
			stdio: "inherit",
		});

		// Validate compilation (simulating consumer testing)
		execSync(typeScriptCheckCommand(), { cwd: testDir, stdio: "inherit" });
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
