/**
 * auth — the credential a device presents to a gated farm.
 *
 * A farm with the auth gate on (REFARM_AUTH_POLICY set) requires a per-device
 * bearer credential on every sidecar request, or answers 401. A device carries
 * it in a private device file; FARM_TOKEN remains the explicit, temporary
 * override. Absent (the default, ungated farm), these headers are empty — so
 * nothing changes for a farm with no gate. Pure seams remain injectable.
 */

import { readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// os-resolution: node — the device token under <home>/.refarm is NODE state; farm-client is zero-dep but already receives env, so SOVEREIGN_BASE costs no dependency
export function farmTokenFile({ env = process.env, home = homedir() } = {}) {
	const explicit = typeof env.FARM_TOKEN_FILE === "string" ? env.FARM_TOKEN_FILE.trim() : "";
	return explicit ? resolve(explicit) : join(home, ".refarm", "credentials", "device-token");
}

/** Inspect without exposing the token. Environment wins; the file must be private on POSIX. */
export function farmCredentialStatus({
	env = process.env,
	// os-resolution: node — same device-token path as farmTokenFile, and it must not diverge from it
	home = homedir(),
	read = readFileSync,
	stat = statSync,
} = {}) {
	const fromEnv = typeof env.FARM_TOKEN === "string" ? env.FARM_TOKEN.trim() : "";
	if (fromEnv) return { ready: true, source: "environment", path: null, issue: null };
	const path = farmTokenFile({ env, home });
	try {
		const info = stat(path);
		if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
			return { ready: false, source: "file", path, issue: "permissions" };
		}
		const token = String(read(path, "utf8")).trim();
		return token
			? { ready: true, source: "file", path, issue: null }
			: { ready: false, source: "file", path, issue: "empty" };
	} catch (error) {
		return {
			ready: false,
			source: "file",
			path,
			issue: error?.code === "ENOENT" ? "missing" : "unreadable",
		};
	}
}

/** Resolve the token without printing it. An unsafe/unreadable file is closed, not guessed. */
// os-resolution: node — same device-token path as farmTokenFile, and it must not diverge from it
export function farmToken({ env = process.env, home = homedir(), read = readFileSync, stat = statSync } = {}) {
	const fromEnv = typeof env.FARM_TOKEN === "string" ? env.FARM_TOKEN.trim() : "";
	if (fromEnv) return fromEnv;
	const status = farmCredentialStatus({ env, home, read, stat });
	if (!status.ready || !status.path) return "";
	return String(read(status.path, "utf8")).trim();
}

/** Store the device credential outside the updateable kit, with Silo's POSIX hardening. */
// os-resolution: node — same device-token path as farmTokenFile, and it must not diverge from it
export async function saveFarmToken(token, { env = process.env, home = homedir() } = {}) {
	const value = typeof token === "string" ? token.trim() : "";
	if (!value) throw new Error("a credencial não pode ser vazia");
	const path = farmTokenFile({ env, home });
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") await chmod(dirname(path), 0o700);
	await writeFile(path, `${value}\n`, { mode: 0o600 });
	if (process.platform !== "win32") await chmod(path, 0o600);
	return { path };
}

// os-resolution: node — same device-token path as farmTokenFile, and it must not diverge from it
export async function removeFarmToken({ env = process.env, home = homedir() } = {}) {
	const path = farmTokenFile({ env, home });
	await rm(path, { force: true });
	return { path };
}

/** The Authorization header for the farm, from env or the private credential file. */
export function farmAuthHeaders(env = process.env, options = {}) {
	const token = farmToken({ env, ...options });
	return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * The `Sec-WebSocket-Protocol` offer for the CRDT sync socket (ADR-093), from
 * the resolved device token: `["refarm-sync-v1", "bearer.<token>"]`. `undefined` when unset —
 * passing `undefined` as `WebSocket`'s second argument is the same as omitting
 * it, so an ungated farm's handshake is byte-identical to before ADR-093.
 * Mirrors `@refarm.dev/sync-loro`'s `WS_SYNC_PROTOCOL`/`bearer.` convention;
 * duplicated (not imported) because this package stays zero-dependency.
 */
export function farmSyncWsProtocols(env = process.env, options = {}) {
	const token = farmToken({ env, ...options });
	return token ? ["refarm-sync-v1", `bearer.${token}`] : undefined;
}
