import { componentize } from "@bytecodealliance/componentize-js";
import { mkdir, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const outUrl = new URL("dist/astro-wasi-ssr.component.wasm", root);

const { component } = await componentize({
	sourcePath: new URL("src/wasi-fetch-entrypoint.mjs", root).pathname,
	witPath: new URL("wit", root).pathname,
	worldName: "astro-wasi-ssr",
});

await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(outUrl, component);
console.log(`wrote ${outUrl.pathname}`);
