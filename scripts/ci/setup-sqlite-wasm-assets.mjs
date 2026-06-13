#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const publicDir = path.resolve(process.cwd(), "public");

function copyMatching(fromDir, matcher) {
	for (const entry of fs.readdirSync(fromDir)) {
		if (!matcher(entry)) continue;
		fs.copyFileSync(path.join(fromDir, entry), path.join(publicDir, entry));
	}
}

fs.mkdirSync(publicDir, { recursive: true });

const sqlitePackageDir = path.dirname(require.resolve("@sqlite.org/sqlite-wasm/package.json", { paths: [process.cwd()] }));
copyMatching(path.join(sqlitePackageDir, "dist"), (entry) => entry.startsWith("sqlite3"));

const sqlJsDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm", { paths: [process.cwd()] }));
copyMatching(sqlJsDir, (entry) => entry.startsWith("sql-wasm") && entry.endsWith(".wasm"));
