import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	CertificateRefusal,
	createCertificateProviderRegistry,
	MAX_LEAF_LIFETIME_DAYS,
} from "@refarm.dev/certificate-contract-v1";
import {
	createNodeCertutilRunner,
	createNssOperationFileSystem,
	detectCertutil,
	type CertutilRunner,
	type NssStore,
} from "@refarm.dev/certificate-local-ca";
import {
	createProcessHandoffSpecFromRunner,
	runProcessHandoffSync,
} from "@refarm.dev/cli/process-handoff";
import {
	createMemoryOperationTrail,
	undoOperationRecord,
	type OperationConsentChannel,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildCertificateRegistry,
	defaultNameSuffixes,
	resolveCertTrailPath,
	resolveNameSuffixes,
	resolveTlsDir,
	runCertIssue,
	runCertProviders,
	runCertTrust,
} from "./cert.js";

/** openssl through the app's sanctioned process seam — `node:child_process` is barred from this
 *  source tree by `test/architecture/process-boundary.test.ts`, tests included. */
const opensslAvailable = (() => {
	try {
		return (
			runProcessHandoffSync(createProcessHandoffSpecFromRunner("openssl", ["version"]), {
				capture: true,
			}).exitCode === 0
		);
	} catch {
		return false;
	}
})();

/** Present-or-not, asked through the package's own seam — `node:child_process` is barred from this
 *  source tree, tests included, and the seam is the sanctioned way to ask. */
const certutilAvailable = (await detectCertutil(createNodeCertutilRunner())).present;

const HOST = "refarm-cert-test";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "refarm-cert-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function answering(answer: string): OperationConsentChannel {
	return {
		async ask() {
			return answer;
		},
	};
}

/** The refusal a call was supposed to make. Resolving instead of refusing is itself the failure —
 *  a `.catch()` that quietly returns the result would let a silent escalation pass as green. */
async function refusalFrom(work: Promise<unknown>): Promise<CertificateRefusal> {
	try {
		await work;
	} catch (error) {
		if (error instanceof CertificateRefusal) return error;
		throw error;
	}
	return expect.unreachable("expected a CertificateRefusal, got a result");
}

describe("where things live is derived, never guessed", () => {
	it("keeps the CA under the sovereign root's .refarm/tls", () => {
		expect(resolveTlsDir("/srv/farm")).toBe("/srv/farm/.refarm/tls");
		expect(resolveCertTrailPath("/srv/farm")).toBe("/srv/farm/.refarm/tls/operations.json");
	});

	it("defaults the CA's constraint to this node's own hostname, and invents nothing wider", () => {
		expect(defaultNameSuffixes("Serpro-1577853")).toEqual(["serpro-1577853"]);
		expect(defaultNameSuffixes("  ")).toEqual([]);
	});
});

describe("resolveNameSuffixes — explicit, then the CA already there, then the hostname guess", () => {
	// The exact shape of the refusal the operator hit: `cert trust` on host `serpro-1577853`,
	// against a CA already constrained to `tail894688.ts.net` — a name with no relation to the
	// hostname at all. Reproduced here without openssl, by writing the same `ca.json` metadata
	// `ensureCa` itself would have written.
	async function writeExistingCaMetadata(nameSuffixes: string[]): Promise<void> {
		await writeFile(
			path.join(dir, "ca.json"),
			JSON.stringify({ caName: "refarm", nameSuffixes, createdAt: "2026-01-01T00:00:00.000Z" }),
		);
	}

	it("an explicit --suffix always wins, CA or no CA", async () => {
		await writeExistingCaMetadata(["tail894688.ts.net"]);
		expect(
			await resolveNameSuffixes({ dir, suffix: ["explicit.example"], hostname: "serpro-1577853" }),
		).toEqual(["explicit.example"]);
	});

	it("with no CA yet, falls back to the hostname guess — unchanged from before this fix", async () => {
		expect(await resolveNameSuffixes({ dir, hostname: "Serpro-1577853" })).toEqual([
			"serpro-1577853",
		]);
	});

	it("prefers an existing CA's own constraint over a hostname that shares nothing with it", async () => {
		await writeExistingCaMetadata(["tail894688.ts.net"]);
		expect(await resolveNameSuffixes({ dir, hostname: "serpro-1577853" })).toEqual([
			"tail894688.ts.net",
		]);
	});

	it("a CA metadata file that fails to parse is treated as no CA, not as a crash", async () => {
		await writeFile(path.join(dir, "ca.json"), "{ not json");
		expect(await resolveNameSuffixes({ dir, hostname: "serpro-1577853" })).toEqual([
			"serpro-1577853",
		]);
	});
});

describe("`refarm cert providers` — the choice is the operator's, so the costs are printed", () => {
	it("reports local-ca with what it needs and what it costs", async () => {
		const report = await runCertProviders({ root: dir, hostname: HOST });
		const local = report.providers.find((entry) => entry.id === "local-ca");
		expect(local).toBeDefined();
		expect(local?.requires.join(" ")).toMatch(/openssl/);
		expect(local?.costs.join(" ")).toMatch(/CANNOT be revoked remotely/);
		expect(local?.costs.join(" ")).toMatch(/no external exposure/);
	});

	it("says out loud that a certificate you already have needs no provider", async () => {
		const report = await runCertProviders({ root: dir, hostname: HOST });
		expect(report.declaredCertificateIsAlwaysAvailable).toBe(true);
	});

	it("exposes the JSON handoff fields every command in this repo exposes", async () => {
		const report = await runCertProviders({ root: dir, hostname: HOST });
		expect(report.ok).toBe(true);
		expect(report.nextCommand).toBeTruthy();
		expect(Array.isArray(report.nextCommands)).toBe(true);
	});

	it("an empty registry reports no providers rather than failing", async () => {
		const report = await runCertProviders({
			root: dir,
			hostname: HOST,
			registry: createCertificateProviderRegistry(),
		});
		expect(report.providers).toEqual([]);
		expect(report.ok).toBe(true);
	});
});

describe("`refarm cert issue` — T2's third case runs no provider at all", () => {
	it("accepts a certificate the operator already has, against an EMPTY registry", async () => {
		const certFile = path.join(dir, "mine.crt");
		const keyFile = path.join(dir, "mine.key");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(certFile, "cert");
		writeFileSync(keyFile, "key");

		const result = await runCertIssue(
			{ certFile, keyFile },
			{ root: dir, hostname: HOST, registry: createCertificateProviderRegistry() },
		);
		expect(result.certificate.providerId).toBeNull();
		expect(result.certificate.certFile).toBe(certFile);
		expect(result.serveCommand).toContain(`--tls-cert ${certFile}`);
		// Nothing was generated: the directory holds exactly the two files the operator put there.
		expect(existsSync(path.join(dir, "ca.crt"))).toBe(false);
	});

	it("refuses half a pair", async () => {
		await expect(
			runCertIssue({ certFile: path.join(dir, "a.crt") }, { root: dir, hostname: HOST }),
		).rejects.toThrow(/go together/);
	});

	it("refuses a certificate that is declared but not there, naming the path", async () => {
		await expect(
			runCertIssue(
				{ certFile: path.join(dir, "gone.crt"), keyFile: path.join(dir, "gone.key") },
				{ root: dir, hostname: HOST, registry: createCertificateProviderRegistry() },
			),
		).rejects.toThrow(/gone\.crt/);
	});
});

describe.skipIf(!opensslAvailable)("`refarm cert issue` — the canonical path", () => {
	it("issues from the node's own CA, for its own name, with a short lifetime", async () => {
		const result = await runCertIssue(
			{ dir, days: 7 },
			{ root: dir, hostname: HOST, say: () => {} },
		);
		expect(result.certificate.providerId).toBe("local-ca");
		expect(result.certificate.names).toEqual([HOST]);
		expect(result.caFile).toBe(path.join(dir, "ca.crt"));

		const leaf = new X509Certificate(readFileSync(result.certificate.certFile));
		const days =
			(Date.parse(result.certificate.notAfter as string) -
				Date.parse(result.certificate.notBefore as string)) /
			86_400_000;
		expect(days).toBeLessThanOrEqual(MAX_LEAF_LIFETIME_DAYS);
		expect(leaf.subjectAltName).toContain(`DNS:${HOST}`);
	});

	it("hands the operator the exact command that serves it beside the plain listener", async () => {
		const result = await runCertIssue({ dir, days: 7 }, { root: dir, hostname: HOST });
		expect(result.serveCommand).toMatch(/refarm web serve .* --tls-cert .* --tls-key /);
		// THE TRUST STEP `issue` POINTS AT IS THE UNPRIVILEGED ONE. It used to be the system store,
		// which needed root, which is why the handoff had to name the interpreter by absolute path —
		// and why the operator ended up typing `sudo` to open a page in their own browser. What that
		// case actually needs is their own NSS store, so the handoff is the bare binary their shell
		// already finds, with no `sudo` in front of it and nothing to look up.
		const trust = result.nextCommands.find((command) => command.includes("cert trust --json"));
		expect(trust).toBe("refarm cert trust --json");
		expect(trust).not.toMatch(/sudo/);
		expect(trust).not.toContain(process.execPath);
	});

	it("re-issuing reuses the same CA — rotation is running the command again", async () => {
		const first = await runCertIssue({ dir, days: 7 }, { root: dir, hostname: HOST });
		const second = await runCertIssue({ dir, days: 7 }, { root: dir, hostname: HOST });
		const a = new X509Certificate(readFileSync(first.caFile as string));
		const b = new X509Certificate(readFileSync(second.caFile as string));
		expect(a.fingerprint256).toBe(b.fingerprint256);
	});
});

describe.skipIf(!opensslAvailable)(
	"`refarm cert trust system` — the privileged grant goes through consent",
	() => {
		let trail: OperationTrail;
		let anchor: string;

		beforeEach(() => {
			trail = createMemoryOperationTrail();
			anchor = path.join(dir, "anchors", "refarm.crt");
		});

		function deps(channel: OperationConsentChannel | null) {
			return {
				root: dir,
				hostname: HOST,
				trail,
				operator: channel,
				now: () => "2026-07-31T12:00:00.000Z",
				say: () => {},
			};
		}

		async function trustSystem(channel: OperationConsentChannel | null) {
			const result = await runCertTrust({ dir, anchor, scope: "system" }, deps(channel));
			if (result.scope !== "system") return expect.unreachable("asked for the system scope");
			return result;
		}

		it("shows the grant — what the CA can do, which device, and how to undo it", async () => {
			const result = await trustSystem(answering("later"));
			const grant = result.grant.join("\n");
			expect(grant).toMatch(/QUALQUER\s+certificado/);
			expect(grant).toContain(HOST);
			expect(grant).toMatch(/NÃO\s+pode ser revogada remotamente/);
			expect(grant).toMatch(/redução de risco, não uma garantia/);
			expect(result.fingerprint).toMatch(/^[0-9A-F:]+$/);
			expect(result.privileged).toBe(true);
		});

		it("'agora não' changes nothing and records nothing", async () => {
			const result = await trustSystem(answering("later"));
			expect(result.status).toBe("deferred");
			expect(existsSync(anchor)).toBe(false);
			expect(await trail.read()).toEqual([]);
		});

		// THE EXACT REFUSAL THE OPERATOR HIT: a CA already exists (issued once under a tailnet
		// suffix that shares nothing with this host's own name), and `cert trust` is run with NO
		// `--suffix`. Before this fix, the default guessed the hostname and collided with the CA's
		// real constraint; the refusal was correct, but nothing should have asked for the collision.
		it("an existing CA's constraint is the default — no --suffix needed to avoid the collision", async () => {
			await runCertIssue(
				{
					dir,
					suffix: ["tail894688.ts.net"],
					name: [`${HOST}.tail894688.ts.net`],
					days: 7,
				},
				{ root: dir, hostname: HOST, say: () => {} },
			);
			// `trustSystem` passes no `--suffix` at all — the exact operator invocation.
			const result = await trustSystem(answering("later"));
			expect(result.status).toBe("deferred");
			expect(result.grant.join("\n")).toContain("tail894688.ts.net");
		});

		it("an explicit --suffix that genuinely conflicts with an existing CA still refuses", async () => {
			await runCertIssue(
				{
					dir,
					suffix: ["tail894688.ts.net"],
					name: [`${HOST}.tail894688.ts.net`],
					days: 7,
				},
				{ root: dir, hostname: HOST, say: () => {} },
			);
			await expect(
				runCertTrust(
					{ dir, anchor, scope: "system", suffix: ["totally-different.example"] },
					deps(answering("authorize")),
				),
			).rejects.toThrow(/widening a CA's constraint in place/);
			expect(existsSync(anchor)).toBe(false);
		});

		it("with no operator to ask, nothing is written", async () => {
			const result = await trustSystem(null);
			expect(result.status).toBe("no-operator");
			expect(existsSync(anchor)).toBe(false);
		});

		it("authorizing installs the anchor — and the undo removes it again", async () => {
			const result = await trustSystem(answering("authorize"));
			expect(result.status).toBe("authorized");
			expect(readFileSync(anchor, "utf8")).toContain("BEGIN CERTIFICATE");
			expect(result.nextCommand).toBe("sudo update-ca-certificates");

			const records = await trail.read();
			const authorized = records[0];
			expect(authorized).toBeDefined();
			await undoOperationRecord({
				record: authorized as NonNullable<typeof authorized>,
				trail,
				now: () => "2026-07-31T13:00:00.000Z",
			});
			expect(existsSync(anchor)).toBe(false);
			expect((await trail.read()).map((r) => r.decision)).toEqual(["authorized", "undone"]);
		});

		it("declining is remembered, so the same question is not asked again", async () => {
			expect((await trustSystem(answering("decline"))).status).toBe("declined");
			expect((await trustSystem(answering("authorize"))).status).toBe("already-decided");
			expect(existsSync(anchor)).toBe(false);
		});

		it("another device is answered honestly — refarm does not pretend to reach its trust store", async () => {
			const result = await runCertTrust({ dir, device: "o celular" }, deps(answering("authorize")));
			if (result.scope !== "manual") return expect.unreachable("another device is manual");
			expect(result.status).toBe("manual");
			expect(result.steps.join("\n")).toMatch(/chave privada não sai daqui/);
			expect(result.steps.join("\n")).toContain(result.fingerprint);
			expect(result.grant.join("\n")).toMatch(/NÃO HÁ COMANDO/);
		});
	},
);

// ── the smallest grant that opens the page ────────────────────────────────────

/**
 * NOTHING BELOW TOUCHES THE OPERATOR'S OWN TRUST STORES. Every certutil call is either against a
 * fake runner that spawns nothing, or against a database this suite creates with `certutil -N`
 * under `tmpdir()` and deletes afterwards. `~/.pki/nssdb` and `~/.mozilla/firefox/*` are never
 * named: `deps.home` and `deps.stores` exist precisely so a test never has to reach for them.
 */
describe.skipIf(!opensslAvailable)(
	"`refarm cert trust` — the default is the smallest grant that achieves the goal",
	() => {
		let trail: OperationTrail;
		let systemAnchor: string;

		const CHROME: NssStore = {
			id: "chromium",
			kind: "chromium",
			label: "Chrome/Chromium",
			dir: "/home/fake/.pki/nssdb",
		};
		const FF_A: NssStore = {
			id: "firefox:default",
			kind: "firefox",
			label: 'Firefox — perfil "default"',
			dir: "/home/fake/.mozilla/firefox/a.default",
			profile: "default",
		};
		const FF_B: NssStore = {
			id: "firefox:default-esr",
			kind: "firefox",
			label: 'Firefox — perfil "default-esr"',
			dir: "/home/fake/.mozilla/firefox/b.esr",
			profile: "default-esr",
		};

		/** A certutil that spawns nothing. `installed` is the pretend database. */
		function fakeCertutil(options: { missing?: boolean } = {}) {
			const installed = new Map<string, string>();
			const calls: string[][] = [];
			const run: CertutilRunner = async (args, stdin) => {
				calls.push([...args]);
				if (options.missing) return { code: null, stdout: "", stderr: "", spawnError: "ENOENT" };
				const db = args[2] ?? "";
				if (args[0] === "-L" && args.includes("-n")) {
					const pem = installed.get(db);
					return pem
						? { code: 0, stdout: pem, stderr: "", spawnError: null }
						: { code: 255, stdout: "", stderr: "Could not find cert", spawnError: null };
				}
				if (args[0] === "-A") installed.set(db, stdin ?? "");
				if (args[0] === "-D") installed.delete(db);
				return { code: 0, stdout: "", stderr: "", spawnError: null };
			};
			return { run, installed, calls };
		}

		beforeEach(() => {
			trail = createMemoryOperationTrail();
			systemAnchor = path.join(dir, "anchors", "refarm.crt");
		});

		function deps(
			channel: OperationConsentChannel | null,
			certutil: CertutilRunner,
			stores: NssStore[],
			announced?: string[],
		) {
			return {
				root: dir,
				hostname: HOST,
				home: "/home/fake",
				trail,
				operator: channel,
				certutil,
				stores,
				now: () => "2026-07-31T12:00:00.000Z",
				say: (line: string) => announced?.push(line),
			};
		}

		it("the DEFAULT is the browser scope — no privilege, and no system anchor is touched", async () => {
			const certutil = fakeCertutil();
			const result = await runCertTrust(
				{ dir },
				deps(answering("authorize"), certutil.run, [CHROME]),
			);
			expect(result.scope).toBe("browser");
			if (result.scope !== "browser") return;
			expect(result.privileged).toBe(false);
			expect(result.stores.map((store) => store.status)).toEqual(["authorized"]);
			// The whole point: the privileged path was never taken.
			expect(existsSync(systemAnchor)).toBe(false);
			expect(existsSync("/usr/local/share/ca-certificates/refarm.crt")).toBe(false);
			expect(certutil.installed.get("sql:/home/fake/.pki/nssdb")).toContain("BEGIN CERTIFICATE");
		});

		it("MUTATION CHECK: with no browser store it REFUSES rather than escalating to root", async () => {
			// The failure this guards against is a default that "helpfully" falls back to the system
			// store — the exact escalation the operator objected to. A refusal that names the larger
			// grant as THEIR choice is the correct answer; silently taking it is not.
			const certutil = fakeCertutil();
			await expect(
				runCertTrust({ dir }, deps(answering("authorize"), certutil.run, [])),
			).rejects.toThrow(/no browser trust store yet/);
			expect(certutil.calls.filter((args) => args[0] === "-A")).toEqual([]);
			expect(existsSync(systemAnchor)).toBe(false);
			expect(await trail.read()).toEqual([]);
		});

		it("the refusal names the system scope as a CHOICE, with the reason and the root cost", async () => {
			const certutil = fakeCertutil();
			const failure = await refusalFrom(
				runCertTrust({ dir }, deps(answering("authorize"), certutil.run, [])),
			);
			expect(failure.fix).toMatch(/curl/);
			expect(failure.fix).toMatch(/needs root/);
			expect(failure.fix).toMatch(/cert trust system/);
			// …and it names where it looked, so "I have no store" is checkable.
			expect(failure.fix).toContain("/home/fake/.pki/nssdb");
			expect(failure.fix).toContain("/home/fake/.mozilla/firefox/profiles.ini");
		});

		it("without certutil it refuses honestly, naming the package — and never crashes", async () => {
			const certutil = fakeCertutil({ missing: true });
			const failure = await refusalFrom(
				runCertTrust({ dir }, deps(answering("authorize"), certutil.run, [CHROME])),
			);
			expect(failure.reason).toBe("tool-missing");
			expect(failure.message).toMatch(/not on PATH/);
			expect(failure.fix).toContain("libnss3-tools");
			expect(certutil.calls.filter((args) => args[0] === "-A")).toEqual([]);
		});

		it("SEVERAL Firefox profiles are several questions — one store may be declined alone", async () => {
			const certutil = fakeCertutil();
			const answers = ["authorize", "decline", "authorize"];
			const channel: OperationConsentChannel = {
				async ask() {
					return answers.shift() ?? "later";
				},
			};
			const result = await runCertTrust(
				{ dir },
				deps(channel, certutil.run, [CHROME, FF_A, FF_B]),
			);
			if (result.scope !== "browser") return expect.unreachable("browser scope");
			expect(result.stores.map((store) => [store.store, store.status])).toEqual([
				["chromium", "authorized"],
				["firefox:default", "declined"],
				["firefox:default-esr", "authorized"],
			]);
			// The declined profile's database was left alone; the other two were written.
			expect(certutil.installed.has("sql:/home/fake/.mozilla/firefox/a.default")).toBe(false);
			expect(certutil.installed.has("sql:/home/fake/.mozilla/firefox/b.esr")).toBe(true);
			// Each store is a DIFFERENT recorded question, not one blanket grant.
			const records = await trail.read();
			expect(new Set(records.map((record) => record.requestId)).size).toBe(3);
		});

		it("ONE Firefox profile, and ZERO Firefox profiles, are both ordinary cases", async () => {
			const one = await runCertTrust(
				{ dir },
				deps(answering("authorize"), fakeCertutil().run, [FF_A]),
			);
			if (one.scope !== "browser") return expect.unreachable("browser scope");
			expect(one.stores.map((store) => store.store)).toEqual(["firefox:default"]);

			// No Firefox at all is not an error while Chrome is there.
			const none = await runCertTrust(
				{ dir },
				deps(answering("authorize"), fakeCertutil().run, [CHROME]),
			);
			if (none.scope !== "browser") return expect.unreachable("browser scope");
			expect(none.stores).toHaveLength(1);
		});

		it("--store narrows to one database and leaves the others undecided", async () => {
			const certutil = fakeCertutil();
			const result = await runCertTrust(
				{ dir, store: ["firefox:default-esr"] },
				deps(answering("authorize"), certutil.run, [CHROME, FF_A, FF_B]),
			);
			if (result.scope !== "browser") return expect.unreachable("browser scope");
			expect(result.stores.map((store) => store.store)).toEqual(["firefox:default-esr"]);
			expect(certutil.installed.has("sql:/home/fake/.pki/nssdb")).toBe(false);
		});

		it("the request NAMES THE STORE and states the reach, before the decision", async () => {
			const announced: string[] = [];
			const result = await runCertTrust(
				{ dir },
				deps(answering("authorize"), fakeCertutil().run, [CHROME], announced),
			);
			if (result.scope !== "browser") return expect.unreachable("browser scope");
			const shown = announced.join("\n");
			expect(shown).toContain("Chrome/Chromium");
			expect(shown).toContain("/home/fake/.pki/nssdb");
			expect(shown).toMatch(/QUAL REPOSITÓRIO MUDA/);
			expect(shown).toMatch(/ATÉ ONDE NÃO VAI/);
			// Reach, in the words that make a later curl failure explainable rather than mysterious.
			expect(shown).toMatch(/curl/);
			expect(shown).toMatch(/SISTEMA/);
			expect(shown).toMatch(/QUALQUER\s+certificado/);
			// …and the machine-readable half says the same thing.
			expect(result.stores[0]?.doesNotReach.join(" ")).toMatch(/curl/);
			expect(result.stores[0]?.doesNotReach.join(" ")).toMatch(/Firefox/);
		});

		it("a Firefox profile says it does not reach the OTHER profiles, nor Chrome", async () => {
			const result = await runCertTrust(
				{ dir },
				deps(answering("authorize"), fakeCertutil().run, [FF_A]),
			);
			if (result.scope !== "browser") return expect.unreachable("browser scope");
			const outside = result.stores[0]?.doesNotReach.join(" ") ?? "";
			expect(outside).toMatch(/OUTROS perfis/);
			expect(outside).toMatch(/\.pki\/nssdb/);
			expect(outside).toMatch(/enterprise_roots/);
		});

		it("hands back the exact certutil that undoes it without refarm", async () => {
			const result = await runCertTrust(
				{ dir },
				deps(answering("authorize"), fakeCertutil().run, [CHROME]),
			);
			if (result.scope !== "browser") return expect.unreachable("browser scope");
			expect(result.stores[0]?.undoCommand).toBe(
				"certutil -D -d sql:/home/fake/.pki/nssdb -n refarm",
			);
		});
	},
);

describe.skipIf(!opensslAvailable || !certutilAvailable)(
	"`refarm cert trust` against a THROWAWAY NSS database — installed, then really removed",
	() => {
		const run = createNodeCertutilRunner();
		let dbDir: string;
		let trail: OperationTrail;

		beforeEach(async () => {
			dbDir = mkdtempSync(path.join(tmpdir(), "refarm-cert-nss-"));
			expect((await run(["-N", "-d", `sql:${dbDir}`, "--empty-password"])).code).toBe(0);
			trail = createMemoryOperationTrail();
		});

		afterEach(() => {
			rmSync(dbDir, { recursive: true, force: true });
		});

		async function listed(): Promise<number | null> {
			return (await run(["-L", "-d", `sql:${dbDir}`, "-n", "refarm", "-a"])).code;
		}

		it("installs into it with no privilege at all, and the undo REMOVES it", async () => {
			const store: NssStore = {
				id: "throwaway",
				kind: "chromium",
				label: "base descartável",
				dir: dbDir,
			};
			const result = await runCertTrust(
				{ dir },
				{
					root: dir,
					hostname: HOST,
					home: dbDir,
					trail,
					operator: answering("authorize"),
					stores: [store],
					now: () => "2026-07-31T12:00:00.000Z",
					say: () => {},
				},
			);
			if (result.scope !== "browser") return expect.unreachable("browser scope");
			expect(result.privileged).toBe(false);
			expect(await listed()).toBe(0);

			const record = (await trail.read())[0];
			expect(record).toBeDefined();
			await undoOperationRecord({
				record: record as NonNullable<typeof record>,
				trail,
				fs: createNssOperationFileSystem(run),
				now: () => "2026-07-31T13:00:00.000Z",
			});
			expect(await listed()).not.toBe(0);
			expect((await trail.read()).map((r) => r.decision)).toEqual(["authorized", "undone"]);
		});
	},
);

describe("the registry is built once, and a second provider would be one line", () => {
	it("holds local-ca and nothing it was not given", () => {
		const { registry, localCa } = buildCertificateRegistry({
			dir,
			nameSuffixes: [HOST],
		});
		expect(registry.ids()).toEqual(["local-ca"]);
		expect(localCa.caCertFile).toBe(path.join(dir, "ca.crt"));
		expect(localCa.nameSuffixes).toEqual([HOST]);
	});
});
