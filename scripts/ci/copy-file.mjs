#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [from, to] = process.argv.slice(2);

if (!from || !to) {
	console.error("usage: copy-file.mjs <from> <to>");
	process.exit(2);
}

const source = path.resolve(process.cwd(), from);
const destination = path.resolve(process.cwd(), to);

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
