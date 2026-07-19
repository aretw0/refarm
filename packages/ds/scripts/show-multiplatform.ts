// A runnable showcase of refarm's defining invariant applied to design tokens: ONE DTCG source projected
// to EVERY surface. For each built-in theme it prints `background` and `primary` as a live ANSI terminal
// swatch (our TUI projection) alongside the exact line each surface ships — CSS var, SCSS, iOS Swift,
// Android XML, Flutter Dart — all derived from src/tokens/<id>.tokens.json. A real consumer of the
// package API (BUILTIN_THEMES, projectThemeToTui) and the generated platform exports.
//
// Run: `pnpm -C packages/ds run demo`

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BUILTIN_THEMES } from "../src/builtin-themes.generated.js";
import { projectThemeToTui } from "../src/theme-tui.js";

const PLATFORMS = fileURLToPath(new URL("../src/platforms/", import.meta.url));
const read = (rel: string): string => readFileSync(PLATFORMS + rel, "utf8");
const lineWith = (text: string, needle: string): string =>
	(text.split("\n").find((l) => l.includes(needle)) ?? "").trim();

/** A filled ANSI-256 background swatch — the token rendered live in the terminal. */
const swatch = (ansi256: number): string => `\x1b[48;5;${ansi256}m      \x1b[0m`;
const pascal = (id: string): string => id.split("-").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");

console.log("\nrefarm DS — one DTCG source → every surface\n" + "=".repeat(44));

for (const [id, theme] of Object.entries(BUILTIN_THEMES)) {
	const tui = projectThemeToTui(theme);
	const cls = `${pascal(id)}Tokens`;
	const snake = id.replace(/-/g, "_");
	console.log(`\n${id}`);
	for (const token of ["background", "primary"] as const) {
		const color = tui[token];
		console.log(`  ${token.padEnd(10)} ${color ? swatch(color.ansi256) : "      "}  ${theme[token]}`);
		console.log(`    css      [data-ds-theme="${id}"] { --${token}: ${theme[token]}; }`);
		console.log(`    scss     ${lineWith(read(`scss/${id}.scss`), `$${token}:`)}`);
		console.log(`    ios      ${lineWith(read(`ios/${cls}.swift`), ` ${token} `)}`);
		console.log(`    android  ${lineWith(read(`android/${id}.xml`), `"${token}"`)}`);
		console.log(`    flutter  ${lineWith(read(`flutter/${snake}.dart`), ` ${token} `)}`);
	}
}
console.log("");
