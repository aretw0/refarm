import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
	new URL("./farmhand-node-loader.mjs", import.meta.url),
	pathToFileURL(`${process.cwd()}/`),
);
