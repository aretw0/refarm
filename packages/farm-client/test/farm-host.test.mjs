import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readRememberedHost, rememberedHostPath, writeRememberedHost } from "../src/farm-host.mjs";

async function tmpKit() {
	return await mkdtemp(join(tmpdir(), "farm-host-"));
}

test("rememberedHostPath is .farm-host under the kit root", () => {
	assert.equal(rememberedHostPath("/a/b"), join("/a/b", ".farm-host"));
});

test("write then read round-trips the host (the name, trimmed)", async () => {
	const dir = await tmpKit();
	try {
		assert.equal(await writeRememberedHost(dir, "serpro-1577853"), true);
		assert.equal(await readRememberedHost(dir), "serpro-1577853");
		// stored with a trailing newline, read back trimmed
		const raw = await readFile(rememberedHostPath(dir), "utf8");
		assert.equal(raw, "serpro-1577853\n");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("readRememberedHost is null when nothing was remembered", async () => {
	const dir = await tmpKit();
	try {
		assert.equal(await readRememberedHost(dir), null);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("writeRememberedHost ignores a blank host (nothing to remember)", async () => {
	const dir = await tmpKit();
	try {
		assert.equal(await writeRememberedHost(dir, "   "), false);
		assert.equal(await writeRememberedHost(dir, ""), false);
		assert.equal(await readRememberedHost(dir), null);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("writeRememberedHost is best-effort — a bad dir returns false, never throws", async () => {
	assert.equal(await writeRememberedHost("/nonexistent-dir-xyz/deep", "h"), false);
});
