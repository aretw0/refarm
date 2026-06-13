import { spawnSync } from "node:child_process";

const allowedSymlinks = new Set(["CLAUDE.md", "GEMINI.md"]);

const result = spawnSync("git", ["ls-files", "-s"], {
	encoding: "utf8",
	windowsHide: true,
});

if (result.status !== 0) {
	process.stderr.write(result.stderr);
	process.exit(result.status ?? 1);
}

const blocked = result.stdout
	.split(/\r?\n/)
	.filter(Boolean)
	.map((line) => {
		const match = line.match(/^(\d{6})\s+\S+\s+\d+\t(.+)$/);
		return match ? { mode: match[1], path: match[2] } : null;
	})
	.filter((entry) => entry?.mode === "120000" && !allowedSymlinks.has(entry.path))
	.map((entry) => entry.path);

if (blocked.length > 0) {
	console.error(
		[
			"[windows-symlink-contracts] Versioned symlinks outside the allowlist are not portable across Windows checkouts.",
			"Allowed symlinks: CLAUDE.md, GEMINI.md",
			"Blocked symlinks:",
			...blocked.map((path) => `- ${path}`),
		].join("\n"),
	);
	process.exit(1);
}

console.log("[windows-symlink-contracts] OK");
