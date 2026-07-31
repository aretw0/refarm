import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createMemoryOperationTrail,
	runOperationConsent,
	undoOperationRecord,
	type OperationConsentChannel,
	type OperationFileSystem,
} from "@refarm.dev/operation-consent-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	CERTUTIL_MISSING_FIX,
	certutilAddArgs,
	certutilCommandLine,
	certutilDeleteArgs,
	certutilListArgs,
	chromiumNssDir,
	createNodeCertutilRunner,
	createNssOperationFileSystem,
	describeNssStoreReach,
	detectCertutil,
	discoverNssStores,
	firefoxProfileRoots,
	NSS_CA_TRUST_FLAGS,
	nssDbSpec,
	nssEntryPath,
	parseFirefoxProfilesIni,
	parseNssEntryPath,
	type CertutilResult,
	type CertutilRunner,
	type NssDiscoveryIo,
	type NssStore,
} from "./nss.js";
import { buildNssCaTrustRequest } from "./trust.js";

/**
 * NOTHING HERE TOUCHES A REAL TRUST STORE. Every database this file creates is made by
 * `certutil -N` under `tmpdir()` and removed in `afterEach`; the operator's `~/.pki/nssdb` and
 * `~/.mozilla/firefox/*` are never named, read or written — a test that proved trust worked by
 * installing a CA on the machine running it would be the exact failure this repo keeps naming.
 */

/** A throwaway CA, generated once and its private key discarded on the spot. Embedded rather than
 *  generated per run so this file needs no openssl for anything but the real-certutil section —
 *  and `certutil -A` parses what it is given, so a fake string would not do. */
const FIXTURE_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDXjCCAkagAwIBAgIUeR8qliBDG4JQy/d3YX5G37+mHhwwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVcmVmYXJtLW5zcy1maXh0dXJlLWNhMCAXDTI2MDczMTE4
MDE0OFoYDzIxMjYwNzA3MTgwMTQ4WjAgMR4wHAYDVQQDDBVyZWZhcm0tbnNzLWZp
eHR1cmUtY2EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCcSywtDokX
8Jk/d0ZoxuwCwPMPJWLJY3xP8zs5fkpT7eRas+QHTvy2XFFDkncj/myvVjbdW+Ok
ZHFhlqFAfTX+HTk9HHtZkC0lHjrwGs9yDOUAUsE0Hl2eyAKKxo6TQucxqIsCC4N9
SKvD3ZNCU4Qwk8Y7Ozp42VcYXVN0cBtr43cjPGw9kNPbBuEWpJEWQKKJ5hZKI633
lZq8ebjlJSBcU1JS5gigf+CliJqgFjWJLnoyuKtEzIpnVKcWyHtOiS5mDRyzAWqY
qAaxGhsfIvOQWKdu5U+bplmVo4cVMBpRp5A9z7XmvFe+U+3VDG1GorwSJpFjEPy0
o7Kv/kwkj2AhAgMBAAGjgY0wgYowHQYDVR0OBBYEFKBfKBPi+kN+8ZairfKsKLsx
4rNoMB8GA1UdIwQYMBaAFKBfKBPi+kN+8ZairfKsKLsx4rNoMBIGA1UdEwEB/wQI
MAYBAf8CAQAwDgYDVR0PAQH/BAQDAgEGMCQGA1UdHgEB/wQaMBigFjAUghJyZWZh
cm0tbnNzLWZpeHR1cmUwDQYJKoZIhvcNAQELBQADggEBADP7ejOjWfU9+0pXY0Y2
AnvjOEdeUGupUbBspyfahjmwo27Y7C3H8FkkS2Yb5Md3FTIOsFn75qw2LylRRSVy
m7ssqw8oj3WlDKroHgvHx7+lF2AlrizATe6cuIoKYWLnTe7ruAKXFzS6kGW1Fz6e
Lhvlbn3JC01DNJMUh4tgQXQ6OMJApj6CbBGRd8nWxEVmG5IM17Ae0QctLp/4lsAM
fr73j0k5HNJdbhkg0+VQzT/u9907EfEKLe227qxGmHxbKeSwSQ8w0EUVaB4maPW7
NJWUWTCMqI+L/mkskyKkeTbbIbJj+UiaaXia5b7bYmKx5m5BD2TJRDL2DWHEj3Af
lK8=
-----END CERTIFICATE-----
`;

const NICKNAME = "refarm";

const CHROMIUM: NssStore = {
	id: "chromium",
	kind: "chromium",
	label: "Chrome/Chromium",
	dir: "/home/op/.pki/nssdb",
};
const FIREFOX: NssStore = {
	id: "firefox:default",
	kind: "firefox",
	label: 'Firefox — perfil "default"',
	dir: "/home/op/.mozilla/firefox/abc.default",
	profile: "default",
};

function answering(answer: string): OperationConsentChannel {
	return {
		async ask() {
			return answer;
		},
	};
}

/** A runner that records what it was asked and answers from a table. Never spawns anything. */
function fakeRunner(
	reply: (args: readonly string[]) => Partial<CertutilResult>,
): CertutilRunner & { calls: { args: string[]; stdin?: string }[] } {
	const calls: { args: string[]; stdin?: string }[] = [];
	const run = (async (args: readonly string[], stdin?: string) => {
		calls.push(stdin === undefined ? { args: [...args] } : { args: [...args], stdin });
		return { code: 0, stdout: "", stderr: "", spawnError: null, ...reply(args) };
	}) as CertutilRunner & { calls: typeof calls };
	run.calls = calls;
	return run;
}

function io(tree: Record<string, string | true>): NssDiscoveryIo {
	return {
		async exists(target) {
			return target in tree;
		},
		async readFile(target) {
			const value = tree[target];
			return typeof value === "string" ? value : null;
		},
	};
}

// ── the arguments ─────────────────────────────────────────────────────────────

describe("the certutil argv is built, not spelled out at call sites", () => {
	it("points at the modern sqlite database and files the CA under a nickname", () => {
		expect(nssDbSpec("/db")).toBe("sql:/db");
		expect(certutilAddArgs("/db", "refarm")).toEqual([
			"-A",
			"-d",
			"sql:/db",
			"-n",
			"refarm",
			"-t",
			"C,,",
			"-a",
		]);
	});

	it("marks the CA as trusted for TLS SERVERS ONLY — not e-mail, not extensions", () => {
		// NSS's columns are SSL,S/MIME,JAR/XPI. Two of the three are deliberately empty.
		expect(NSS_CA_TRUST_FLAGS).toBe("C,,");
		expect(NSS_CA_TRUST_FLAGS.split(",")).toEqual(["C", "", ""]);
	});

	it("the undo is a real command, and it is the one the summary prints", () => {
		expect(certutilDeleteArgs("/db", "refarm")).toEqual(["-D", "-d", "sql:/db", "-n", "refarm"]);
		expect(certutilCommandLine(certutilDeleteArgs("/db", "refarm"))).toBe(
			"certutil -D -d sql:/db -n refarm",
		);
	});

	it("quotes a token a shell would otherwise re-split", () => {
		expect(certutilCommandLine(certutilListArgs("/db", "my ca"))).toContain("'my ca'");
	});

	it("names ONE ENTRY in ONE database, and reads back", () => {
		const path = nssEntryPath("/home/op/.pki/nssdb", "refarm");
		expect(path).toBe("/home/op/.pki/nssdb#refarm");
		expect(parseNssEntryPath(path)).toEqual({ dir: "/home/op/.pki/nssdb", nickname: "refarm" });
		expect(parseNssEntryPath("/plain/file.crt")).toBeNull();
		expect(parseNssEntryPath("#refarm")).toBeNull();
	});
});

// ── Firefox is not one store ──────────────────────────────────────────────────

describe("Firefox is not one store — profiles.ini is the authority on how many there are", () => {
	it("reads several profiles, keeping each one's own directory", () => {
		const profiles = parseFirefoxProfilesIni(
			[
				"[Profile1]",
				"Name=default",
				"IsRelative=1",
				"Path=xk6yqvcr.default",
				"Default=1",
				"",
				"[Profile0]",
				"Name=default-esr",
				"IsRelative=1",
				"Path=9dnbc7mi.default-esr",
				"",
				"[General]",
				"StartWithLastProfile=1",
				"Version=2",
				"",
				"[Install6AFDA46A1A8AD48]",
				"Default=9dnbc7mi.default-esr",
				"Locked=1",
			].join("\n"),
		);
		expect(profiles.map((profile) => profile.name)).toEqual(["default", "default-esr"]);
		expect(profiles.every((profile) => profile.isRelative)).toBe(true);
	});

	it("reads ONE profile", () => {
		const profiles = parseFirefoxProfilesIni("[Profile0]\nName=solo\nIsRelative=1\nPath=a.solo\n");
		expect(profiles).toEqual([{ name: "solo", path: "a.solo", isRelative: true }]);
	});

	it("reads NONE — an index with no profile section is zero profiles, not a crash", () => {
		expect(parseFirefoxProfilesIni("[General]\nVersion=2\n")).toEqual([]);
		expect(parseFirefoxProfilesIni("")).toEqual([]);
	});

	it("honours an absolute Path, which IsRelative=0 declares", () => {
		const profiles = parseFirefoxProfilesIni(
			"[Profile0]\nName=elsewhere\nIsRelative=0\nPath=/srv/profiles/ff\n",
		);
		expect(profiles[0]?.isRelative).toBe(false);
		expect(profiles[0]?.path).toBe("/srv/profiles/ff");
	});

	it("searches the packaged locations too, because packaging moved it twice", () => {
		const roots = firefoxProfileRoots("/home/op");
		expect(roots).toContain("/home/op/.mozilla/firefox");
		expect(roots.some((root) => root.includes("/snap/"))).toBe(true);
		expect(roots.some((root) => root.includes("/.var/app/"))).toBe(true);
	});
});

describe("discovery measures what is there — zero, one, or several", () => {
	it("finds nothing on a user who has never opened a browser", async () => {
		expect(await discoverNssStores({ home: "/home/op", io: io({}) })).toEqual([]);
	});

	it("finds the Chromium store when its directory exists", async () => {
		const stores = await discoverNssStores({
			home: "/home/op",
			io: io({ "/home/op/.pki/nssdb": true }),
		});
		expect(stores).toEqual([
			{ id: "chromium", kind: "chromium", label: "Chrome/Chromium", dir: chromiumNssDir("/home/op") },
		]);
	});

	it("finds SEVERAL Firefox profiles, each as its own store", async () => {
		const stores = await discoverNssStores({
			home: "/home/op",
			io: io({
				"/home/op/.mozilla/firefox/profiles.ini":
					"[Profile0]\nName=default\nIsRelative=1\nPath=a.default\n" +
					"[Profile1]\nName=default-esr\nIsRelative=1\nPath=b.esr\n",
				"/home/op/.mozilla/firefox/a.default/cert9.db": true,
				"/home/op/.mozilla/firefox/b.esr/cert9.db": true,
			}),
		});
		expect(stores.map((store) => store.id)).toEqual(["firefox:default", "firefox:default-esr"]);
		expect(stores.map((store) => store.dir)).toEqual([
			"/home/op/.mozilla/firefox/a.default",
			"/home/op/.mozilla/firefox/b.esr",
		]);
	});

	it("skips a profile Firefox has never opened — there is no database to add to", async () => {
		const stores = await discoverNssStores({
			home: "/home/op",
			io: io({
				"/home/op/.mozilla/firefox/profiles.ini":
					"[Profile0]\nName=used\nIsRelative=1\nPath=a\n[Profile1]\nName=fresh\nIsRelative=1\nPath=b\n",
				"/home/op/.mozilla/firefox/a/cert9.db": true,
			}),
		});
		expect(stores.map((store) => store.id)).toEqual(["firefox:used"]);
	});

	it("finds a snap-packaged Firefox, and does not report the same directory twice", async () => {
		const ini = "[Profile0]\nName=default\nIsRelative=0\nPath=/shared/ff\n";
		const stores = await discoverNssStores({
			home: "/home/op",
			io: io({
				"/home/op/.mozilla/firefox/profiles.ini": ini,
				"/home/op/snap/firefox/common/.mozilla/firefox/profiles.ini": ini,
				"/shared/ff/cert9.db": true,
			}),
		});
		expect(stores).toHaveLength(1);
		expect(stores[0]?.dir).toBe("/shared/ff");
	});

	it("keeps ids distinct when two roots name their profile the same thing", async () => {
		const stores = await discoverNssStores({
			home: "/home/op",
			io: io({
				"/home/op/.mozilla/firefox/profiles.ini":
					"[Profile0]\nName=default\nIsRelative=1\nPath=a\n",
				"/home/op/.mozilla/firefox/a/cert9.db": true,
				"/home/op/snap/firefox/common/.mozilla/firefox/profiles.ini":
					"[Profile0]\nName=default\nIsRelative=1\nPath=a\n",
				"/home/op/snap/firefox/common/.mozilla/firefox/a/cert9.db": true,
			}),
		});
		expect(stores.map((store) => store.id)).toEqual(["firefox:default", "firefox:default-2"]);
	});
});

// ── reach ─────────────────────────────────────────────────────────────────────

describe("the reach of a store is stated, so a later curl failure is explainable", () => {
	it("says Chrome's store does NOT make curl or node trust the CA", () => {
		const reach = describeNssStoreReach(CHROMIUM);
		expect(reach.reaches.join(" ")).toMatch(/Chrome/);
		const outside = reach.doesNotReach.join(" ");
		expect(outside).toMatch(/curl/);
		expect(outside).toMatch(/node/);
		expect(outside).toMatch(/SISTEMA/);
		expect(outside).toMatch(/Firefox/);
	});

	it("says one Firefox profile does not reach another, nor Chrome, nor the system", () => {
		const outside = describeNssStoreReach(FIREFOX).doesNotReach.join(" ");
		expect(outside).toMatch(/OUTROS perfis/);
		expect(outside).toMatch(/\.pki\/nssdb/);
		expect(outside).toMatch(/enterprise_roots/);
	});
});

// ── the request ───────────────────────────────────────────────────────────────

describe("the NSS grant is its own question, per store", () => {
	function requestFor(store: NssStore, existingPem: string | null = null) {
		return buildNssCaTrustRequest({
			caName: "refarm",
			caPem: FIXTURE_CA_PEM,
			fingerprint: "AA:BB:CC",
			nameSuffixes: ["example.ts.net"],
			device: "este notebook",
			store,
			nickname: NICKNAME,
			existingPem,
			requester: "refarm cert trust",
			requestedAt: "2026-07-31T12:00:00.000Z",
		});
	}

	it("names WHICH STORE in the title, with the directory", () => {
		const request = requestFor(CHROMIUM);
		expect(request.title).toContain("Chrome/Chromium");
		expect(request.title).toContain(CHROMIUM.dir);
		expect(request.title).toMatch(/sem privilégio/);
	});

	it("Chrome and a Firefox profile are DIFFERENT questions", () => {
		expect(requestFor(CHROMIUM).id).not.toBe(requestFor(FIREFOX).id);
		expect(requestFor(CHROMIUM).id).toBe("ca-trust:este notebook:chromium:AA:BB:CC");
	});

	it("carries the reach into the notes the operator reads while deciding", () => {
		const notes = requestFor(CHROMIUM).notes?.join("\n") ?? "";
		expect(notes).toMatch(/QUAL REPOSITÓRIO MUDA/);
		expect(notes).toMatch(/ATÉ ONDE NÃO VAI/);
		expect(notes).toMatch(/curl/);
		expect(notes).toMatch(/QUALQUER\s+certificado/);
		expect(notes).toContain("example.ts.net");
	});

	it("says out loud that no privilege and no further command are involved", () => {
		const notes = requestFor(CHROMIUM).notes?.join("\n") ?? "";
		expect(notes).toMatch(/NÃO PEDE PRIVILÉGIO/);
		expect(notes).not.toMatch(/update-ca-certificates/);
	});

	it("proposes the ENTRY, and shows what is filed under that nickname right now", () => {
		const request = requestFor(CHROMIUM, "-----BEGIN CERTIFICATE-----\nold\n");
		expect(request.changes[0]?.path).toBe(nssEntryPath(CHROMIUM.dir, NICKNAME));
		expect(request.changes[0]?.after).toBe(FIXTURE_CA_PEM);
		expect(request.changes[0]?.before).toContain("old");
	});

	it("the undo names the exact certutil the operator could run themselves", () => {
		const undo = requestFor(FIREFOX).undo;
		expect(undo.kind).toBe("restore-snapshot");
		expect(undo.kind === "restore-snapshot" && undo.summary).toContain(
			`certutil -D -d sql:${FIREFOX.dir} -n refarm`,
		);
	});
});

// ── the filesystem over certutil ──────────────────────────────────────────────

describe("consent applies and reverses this through certutil, not through a file", () => {
	it("reads the installed entry with -L, and treats 'not found' as 'nothing installed'", async () => {
		const run = fakeRunner((args) => (args[0] === "-L" ? { code: 255 } : {}));
		const fs = createNssOperationFileSystem(run);
		expect(await fs.readFile(nssEntryPath("/db", NICKNAME))).toBeNull();
		expect(run.calls[0]?.args).toEqual(certutilListArgs("/db", NICKNAME));
	});

	it("installs with -A, feeding the certificate the operator was shown on STDIN", async () => {
		const run = fakeRunner(() => ({}));
		await createNssOperationFileSystem(run).writeFile(
			nssEntryPath("/db", NICKNAME),
			FIXTURE_CA_PEM,
		);
		expect(run.calls[0]?.args).toEqual(certutilAddArgs("/db", NICKNAME));
		expect(run.calls[0]?.stdin).toBe(FIXTURE_CA_PEM);
	});

	it("removes with -D — and asks first, because certutil errors on an absent nickname", async () => {
		const present = fakeRunner((args) => (args[0] === "-L" ? { stdout: FIXTURE_CA_PEM } : {}));
		await createNssOperationFileSystem(present).removeFile(nssEntryPath("/db", NICKNAME));
		expect(present.calls.map((call) => call.args[0])).toEqual(["-L", "-D"]);
		expect(present.calls[1]?.args).toEqual(certutilDeleteArgs("/db", NICKNAME));

		const absent = fakeRunner((args) => (args[0] === "-L" ? { code: 255 } : {}));
		await createNssOperationFileSystem(absent).removeFile(nssEntryPath("/db", NICKNAME));
		expect(absent.calls.map((call) => call.args[0])).toEqual(["-L"]);
	});

	it("refuses a path that does not name an entry, rather than writing a file called '#refarm'", async () => {
		await expect(
			createNssOperationFileSystem(fakeRunner(() => ({}))).writeFile("/plain.crt", "x"),
		).rejects.toThrow(/does not name an entry/);
	});
});

describe("without certutil there is a refusal that names the package, never a crash", () => {
	const missing = fakeRunner(() => ({ code: null, spawnError: "ENOENT" }));

	it("detection answers 'no' instead of throwing", async () => {
		const presence = await detectCertutil(missing);
		expect(presence.present).toBe(false);
		expect(presence.present === false && presence.detail).toMatch(/not on PATH/);
	});

	it("names libnss3-tools, and the per-distro package beside it", () => {
		expect(CERTUTIL_MISSING_FIX).toContain("libnss3-tools");
		expect(CERTUTIL_MISSING_FIX).toContain("nss-tools");
	});

	it("an attempted install refuses with the fix attached", async () => {
		await expect(
			createNssOperationFileSystem(missing).writeFile(nssEntryPath("/db", NICKNAME), "x"),
		).rejects.toThrow(/libnss3-tools/);
	});
});

// ── against real certutil, on a database made for the test and deleted after ──

const certutilPresent = (await detectCertutil(createNodeCertutilRunner())).present;

describe.skipIf(!certutilPresent)("the whole journey, against a THROWAWAY NSS database", () => {
	const run = createNodeCertutilRunner();
	let dbDir: string;
	let store: NssStore;

	async function installed(): Promise<string | null> {
		const result = await run(certutilListArgs(dbDir, NICKNAME));
		return result.code === 0 ? result.stdout : null;
	}

	beforeEach(async () => {
		dbDir = mkdtempSync(join(tmpdir(), "refarm-nss-"));
		const created = await run(["-N", "-d", nssDbSpec(dbDir), "--empty-password"]);
		expect(created.code).toBe(0);
		store = { id: "throwaway", kind: "chromium", label: "base descartável", dir: dbDir };
	});

	afterEach(() => {
		rmSync(dbDir, { recursive: true, force: true });
	});

	function requestFor() {
		return buildNssCaTrustRequest({
			caName: "refarm",
			caPem: FIXTURE_CA_PEM,
			fingerprint: "AA:BB:CC",
			nameSuffixes: ["refarm-nss-fixture"],
			device: "esta máquina de teste",
			store,
			nickname: NICKNAME,
			requester: "refarm cert trust",
			requestedAt: "2026-07-31T12:00:00.000Z",
		});
	}

	it("starts empty — the assertion below is not vacuous", async () => {
		expect(await installed()).toBeNull();
	});

	it("authorizing installs the CA into that database, marked C,, and nothing more", async () => {
		const outcome = await runOperationConsent({
			request: requestFor(),
			trail: createMemoryOperationTrail(),
			channel: answering("authorize"),
			fs: createNssOperationFileSystem(run),
			now: () => "2026-07-31T12:00:01.000Z",
		});
		expect(outcome.status).toBe("authorized");
		expect(await installed()).toContain("BEGIN CERTIFICATE");

		const listed = await run(["-L", "-d", nssDbSpec(dbDir)]);
		expect(listed.stdout).toMatch(new RegExp(`${NICKNAME}\\s+C,,`));
	});

	it("declining installs NOTHING", async () => {
		const outcome = await runOperationConsent({
			request: requestFor(),
			trail: createMemoryOperationTrail(),
			channel: answering("decline"),
			fs: createNssOperationFileSystem(run),
			now: () => "2026-07-31T12:00:01.000Z",
		});
		expect(outcome.status).toBe("declined");
		expect(await installed()).toBeNull();
	});

	it("AND THE UNDO ACTUALLY REMOVES IT — certutil -D runs here, it is not described", async () => {
		const trail = createMemoryOperationTrail();
		const fs = createNssOperationFileSystem(run);
		const authorized = await runOperationConsent({
			request: requestFor(),
			trail,
			channel: answering("authorize"),
			fs,
			now: () => "2026-07-31T12:00:01.000Z",
		});
		if (authorized.record === null) return expect.unreachable("should have recorded");
		expect(await installed()).not.toBeNull();

		const undone = await undoOperationRecord({
			record: authorized.record,
			trail,
			fs,
			now: () => "2026-07-31T12:30:00.000Z",
		});

		expect(await installed()).toBeNull();
		expect(undone.decision).toBe("undone");
		expect((await trail.read()).map((record) => record.decision)).toEqual(["authorized", "undone"]);
	});

	it("MUTATION CHECK: an undo that only SAYS it removes leaves the entry, and this catches it", async () => {
		// The proof that the assertion above has teeth. Same journey, same recorded undo — but a
		// filesystem whose removal is a no-op, which is exactly what "the undo is a sentence in the
		// summary" would amount to. If the check could not tell the difference, it would pass here.
		const trail = createMemoryOperationTrail();
		const real = createNssOperationFileSystem(run);
		const pretending: OperationFileSystem = {
			readFile: real.readFile,
			writeFile: real.writeFile,
			async removeFile() {
				/* says it removed; removes nothing */
			},
		};
		const authorized = await runOperationConsent({
			request: requestFor(),
			trail,
			channel: answering("authorize"),
			fs: pretending,
			now: () => "2026-07-31T12:00:01.000Z",
		});
		if (authorized.record === null) return expect.unreachable("should have recorded");

		await undoOperationRecord({
			record: authorized.record,
			trail,
			fs: pretending,
			now: () => "2026-07-31T12:30:00.000Z",
		});
		expect(await installed()).not.toBeNull();

		// …and the real filesystem, given the same record, does remove it.
		await undoOperationRecord({
			record: authorized.record,
			trail,
			fs: real,
			now: () => "2026-07-31T12:45:00.000Z",
		});
		expect(await installed()).toBeNull();
	});

	it("re-installing after an undo puts back exactly the certificate that was there", async () => {
		const trail = createMemoryOperationTrail();
		const fs = createNssOperationFileSystem(run);
		const first = await runOperationConsent({
			request: requestFor(),
			trail,
			channel: answering("authorize"),
			fs,
			now: () => "2026-07-31T12:00:01.000Z",
		});
		if (first.record === null) return expect.unreachable("should have recorded");
		const beforeUndo = await installed();
		await undoOperationRecord({ record: first.record, trail, fs, now: () => "2026-07-31T12:30:00.000Z" });

		const again = await runOperationConsent({
			request: requestFor(),
			trail,
			channel: answering("authorize"),
			fs,
			now: () => "2026-07-31T13:00:00.000Z",
			revisit: true,
		});
		expect(again.status).toBe("authorized");
		expect(await installed()).toBe(beforeUndo);
	});
});
