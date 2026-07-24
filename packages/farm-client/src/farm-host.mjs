/**
 * farm-host — the kit remembers the farm it came from.
 *
 * farm-update writes the host it pulled from; farm-ask (and kin) read it as a
 * default. So after the first `FARM_HOST=<name> farm-update`, a device never
 * repeats the host — the kit points back at its own farm. What's stored is the
 * host STRING the operator gave (the MagicDNS name, stable — never the IP, which
 * can rotate). Per-device runtime state: it lives beside the installed kit, is
 * never distributed, and is read tolerantly (absent → null).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REMEMBERED_FILE = ".farm-host";

/** Where the remembered host lives, given a kit root dir. PURE. */
export function rememberedHostPath(kitRootDir) {
	return join(kitRootDir, REMEMBERED_FILE);
}

/** The host the kit last pulled from, or null. Absent/blank file → null. */
export async function readRememberedHost(kitRootDir) {
	try {
		const raw = (await readFile(rememberedHostPath(kitRootDir), "utf8")).trim();
		return raw || null;
	} catch {
		return null;
	}
}

/** Persist the farm host this kit came from. Best-effort — a write failure is
 * non-fatal (the update still succeeded), so this returns a boolean, never throws. */
export async function writeRememberedHost(kitRootDir, host) {
	if (typeof host !== "string" || !host.trim()) return false;
	try {
		await writeFile(rememberedHostPath(kitRootDir), `${host.trim()}\n`);
		return true;
	} catch {
		return false;
	}
}
