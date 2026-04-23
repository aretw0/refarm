/**
 * Barn (O Celeiro) — Machinery Manager for Refarm.
 *
 * Responsibilities:
 * 1. Plugin Lifecycle Management (Install/Uninstall).
 * 2. Binary cache management (OPFS-compatible shape; in-memory for now).
 * 3. Inventory of available and installed plugins.
 * 4. SHA-256 integrity enforcement on install.
 */

export interface PluginEntry {
	id: string;
	url: string;
	integrity: string;
	status: "pending" | "installed" | "error";
	installedAt: number;
	cacheStatus: "hit" | "miss";
	wasmHash: string;
}

type Sha256Digest = {
	base64: string;
	hex: string;
};

type CachedBinary = {
	bytes: ArrayBuffer;
	digest: Sha256Digest;
	cachedAt: number;
};

const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;
const SHA256_BASE64_RE = /^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{43})$/;

export class Barn {
	private _inventory: Map<string, PluginEntry> = new Map();
	private _cacheByUrl: Map<string, CachedBinary> = new Map();

	constructor() {
		console.log("[barn] Barn initialized.");
	}

	private toHex(buffer: ArrayBuffer): string {
		return Array.from(new Uint8Array(buffer))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	private toBase64(buffer: ArrayBuffer): string {
		return Buffer.from(new Uint8Array(buffer)).toString("base64");
	}

	private async computeDigest(buffer: ArrayBuffer): Promise<Sha256Digest> {
		const digestBuffer = await crypto.subtle.digest("SHA-256", buffer);
		return {
			base64: this.toBase64(digestBuffer),
			hex: this.toHex(digestBuffer),
		};
	}

	private parseIntegrity(integrity: string): string {
		const normalized = integrity.trim();
		if (!normalized.startsWith("sha256-")) {
			throw new Error("Integrity must use sha256- prefix");
		}

		const value = normalized.slice("sha256-".length);
		if (!value) {
			throw new Error("Integrity digest is empty");
		}

		if (!SHA256_HEX_RE.test(value) && !SHA256_BASE64_RE.test(value)) {
			throw new Error(
				"Integrity digest must be 64-char hex or base64 sha256 value",
			);
		}

		return value;
	}

	private isDigestMatch(expectedDigest: string, actual: Sha256Digest): boolean {
		if (SHA256_HEX_RE.test(expectedDigest)) {
			return expectedDigest.toLowerCase() === actual.hex;
		}
		return expectedDigest === actual.base64;
	}

	async installPlugin(url: string, integrity: string): Promise<PluginEntry> {
		const expectedDigest = this.parseIntegrity(integrity);

		let cached = this._cacheByUrl.get(url);
		let cacheStatus: PluginEntry["cacheStatus"] = "hit";

		if (!cached) {
			cacheStatus = "miss";

			const response = await fetch(url);
			if (!response.ok)
				throw new Error(`Failed to fetch plugin: ${response.statusText}`);

			const bytes = await response.arrayBuffer();
			const digest = await this.computeDigest(bytes);

			if (!this.isDigestMatch(expectedDigest, digest)) {
				throw new Error("Integrity verification failed");
			}

			cached = {
				bytes,
				digest,
				cachedAt: Date.now(),
			};
			this._cacheByUrl.set(url, cached);
		} else if (!this.isDigestMatch(expectedDigest, cached.digest)) {
			throw new Error(
				"Integrity verification failed (cached artifact mismatch)",
			);
		}

		const id = `urn:refarm:plugin:${Math.random().toString(36).substring(2, 11)}`;
		const entry: PluginEntry = {
			id,
			url,
			integrity,
			status: "installed",
			installedAt: Date.now(),
			cacheStatus,
			wasmHash: `sha256-${cached.digest.base64}`,
		};

		this._inventory.set(id, entry);
		return entry;
	}

	async listPlugins(): Promise<PluginEntry[]> {
		return Array.from(this._inventory.values());
	}

	async uninstallPlugin(id: string): Promise<void> {
		if (!this._inventory.has(id)) {
			throw new Error(`Plugin not found: ${id}`);
		}
		this._inventory.delete(id);
	}
}
