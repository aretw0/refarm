import { appendFile, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { declaredBase, sovereignDir } from "@refarm.dev/config";

import {
	type SasExchange,
	type SasExchangeStore,
	type SasSettlement,
	type SasVerificationRecord,
} from "@refarm.dev/emoji-sas-v1";

/**
 * The exchange, on disk, because the two halves are two processes.
 *
 * `refarm web serve` STARTS an exchange; the CLI CONFIRMS it. That split is not an
 * implementation detail to be tidied away — it is S4. "Initiation is symmetric,
 * authorisation is not": the confirming side must be one that already holds authority,
 * and the listener a party with no credential can reach is definitionally not that.
 * Two processes therefore need shared state, and the filesystem is where this repo
 * already puts exactly this kind of state: `auth-policy.json` is written by TypeScript,
 * read by Rust, and re-read on a poll. Nothing new is being invented here.
 *
 * WHAT LIVES HERE AND HOW IT IS PROTECTED. One JSON file per pending exchange, mode
 * 0600, in a 0700 directory beside the auth policy. While pending, a file holds this
 * node's ephemeral PRIVATE key — the only sensitive thing in the whole flow — so that
 * the confirming CLI can derive the emoji row ITSELF rather than trusting a row
 * computed by the process that answered the browser. Settling clears it, in both
 * directions.
 *
 * FIRST SETTLEMENT WINS, ACROSS PROCESSES. The operator confirming, the deadline
 * passing, and a sweep running in `web serve` can all race. `settle` claims with an
 * `O_EXCL` marker file — the one primitive the filesystem gives us that is a genuine
 * compare-and-set across processes — so exactly one caller gets to write an outcome and
 * every other is told `null`. Without it, "a mismatch is never a retry" would hold in
 * one process and not between two.
 */

/** Directory name under the refarm dir. */
export const SAS_DIR_NAME = "sas";

/** The durable record S5 asks for. Append-only NDJSON, never rewritten. */
export const SAS_RECORD_FILE = "verification-log.ndjson";

/**
 * Where the exchanges for a given policy live: a `sas/` directory beside the policy
 * file itself.
 *
 * DERIVED from the policy path rather than resolved independently, so `--policy` moves
 * both together. A test pointing at a throwaway policy under /tmp gets a throwaway
 * exchange directory with it, and can never touch the operator's.
 */
export function resolveSasDir(policyPath: string): string {
	return path.join(path.dirname(path.resolve(policyPath)), SAS_DIR_NAME);
}

/**
 * The policy path `web serve` should use, by the SAME precedence the daemon follows
 * (`packages/tractor/src/sidecar/auth.rs`): a non-blank `REFARM_AUTH_POLICY` wins,
 * otherwise `<root>/.refarm/auth-policy.json`.
 *
 * Mirrored deliberately. A third reader of the same file that resolved it its own way
 * is how two halves of one node start disagreeing about which farm they are in — the
 * defect `resolve_policy_path` exists to close, and it would be free to reappear here.
 */
export function resolveAuthPolicyPath(
	options: { root?: string; env?: NodeJS.ProcessEnv } = {},
): string {
	const env = options.env ?? process.env;
	const override = (env.REFARM_AUTH_POLICY ?? "").trim();
	if (override) return path.resolve(override);
	// The NODE's credential policy. A cwd default put it under whatever directory ran the
	// command, so `refarm sas` answered for a different gate depending on where it was typed.
	return path.resolve(options.root ?? declaredBase(), sovereignDir(), "auth-policy.json");
}

function exchangePath(dir: string, id: string): string {
	// The id is minted by `newSasSessionId` (base64url) and validated by the HTTP
	// surface's route pattern before it ever reaches here, but a store must not depend
	// on its caller's validation for a path join.
	if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error(`emoji-sas: refusing an unsafe exchange id`);
	return path.join(dir, `${id}.json`);
}

function claimPath(dir: string, id: string): string {
	return `${exchangePath(dir, id)}.settling`;
}

async function readExchange(file: string): Promise<SasExchange | null> {
	try {
		return JSON.parse(await readFile(file, "utf8")) as SasExchange;
	} catch {
		// A half-written or corrupt exchange is not an exchange. It is swept by the next
		// settle/list rather than crashing a command an operator is standing in front of.
		return null;
	}
}

async function writeAtomic(file: string, body: string): Promise<void> {
	const tmp = `${file}.tmp-${process.pid}`;
	await writeFile(tmp, body, { mode: 0o600 });
	await rename(tmp, file);
}

export function createFilesystemSasExchangeStore(dir: string): SasExchangeStore {
	const root = path.resolve(dir);
	const ensure = async (): Promise<void> => {
		await mkdir(root, { recursive: true, mode: 0o700 });
	};

	return {
		async create(exchange: SasExchange): Promise<void> {
			await ensure();
			const file = exchangePath(root, exchange.id);
			// `wx` — an id that already exists is a collision, not something to overwrite.
			const handle = await open(file, "wx", 0o600);
			try {
				await handle.writeFile(`${JSON.stringify(exchange, null, 2)}\n`);
			} finally {
				await handle.close();
			}
		},

		async get(id: string): Promise<SasExchange | null> {
			return readExchange(exchangePath(root, id));
		},

		async list(): Promise<SasExchange[]> {
			let entries: string[];
			try {
				entries = await readdir(root);
			} catch {
				return [];
			}
			const exchanges: SasExchange[] = [];
			for (const entry of entries) {
				if (!entry.endsWith(".json")) continue;
				const exchange = await readExchange(path.join(root, entry));
				if (exchange) exchanges.push(exchange);
			}
			return exchanges.sort((a, b) => a.createdAt - b.createdAt);
		},

		async settle(id: string, settlement: SasSettlement): Promise<SasExchange | null> {
			const file = exchangePath(root, id);
			const existing = await readExchange(file);
			if (!existing || existing.state !== "pending") return null;
			// THE cross-process compare-and-set. O_EXCL either creates the marker or
			// fails; the loser returns null and never writes an outcome.
			let claim;
			try {
				claim = await open(claimPath(root, id), "wx", 0o600);
			} catch {
				return null;
			}
			await claim.close();
			const settled: SasExchange = {
				...existing,
				state: settlement.state,
				settledAt: settlement.at,
				// The private key does not survive a settlement, whichever way it went.
				confirmerPrivateKeyJwk: null,
				sealed: settlement.sealed ?? null,
				credentialId: settlement.credentialId ?? null,
				abortReason: settlement.abortReason ?? null,
			};
			await writeAtomic(file, `${JSON.stringify(settled, null, 2)}\n`);
			return settled;
		},

		async remove(id: string): Promise<void> {
			await rm(exchangePath(root, id), { force: true });
			await rm(claimPath(root, id), { force: true });
		},

		async record(entry: SasVerificationRecord): Promise<void> {
			await ensure();
			// Append-only, and the ONE place an outcome becomes durable. A mismatch is the
			// single signal this mechanism exists to produce (S5); a log that could be
			// rewritten in place would be a log that can lose it.
			await appendFile(path.join(root, SAS_RECORD_FILE), `${JSON.stringify(entry)}\n`, {
				mode: 0o600,
			});
		},

		async records(limit?: number): Promise<SasVerificationRecord[]> {
			let raw: string;
			try {
				raw = await readFile(path.join(root, SAS_RECORD_FILE), "utf8");
			} catch {
				return [];
			}
			const entries: SasVerificationRecord[] = [];
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				try {
					entries.push(JSON.parse(line) as SasVerificationRecord);
				} catch {
					// A truncated final line (a crash mid-append) is skipped, never fatal.
				}
			}
			return limit === undefined ? entries : entries.slice(-limit);
		},
	};
}
