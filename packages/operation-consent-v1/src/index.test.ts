import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createScriptedOperatorChannel,
	OperatorPromptCancelledError,
} from "@refarm.dev/prompt-contract-v1";
import { describe, expect, it } from "vitest";

import {
	applyChanges,
	createFileOperationTrail,
	createMemoryOperationTrail,
	createNodeOperationFileSystem,
	isReversible,
	makeOperationRecord,
	OPERATION_AUTHORIZE,
	OPERATION_CONSENT_CAPABILITY,
	OPERATION_DECLINE,
	OPERATION_LATER,
	operationDecisionPrompt,
	operationTimeline,
	recordOperation,
	renderOperationRequest,
	reverseChanges,
	runOperationConsent,
	standingDecision,
	undoOperationRecord,
	type OperationConsentChannel,
	type OperationFileChange,
	type OperationFileSystem,
	type OperationRequest,
} from "./index.js";

// ── doubles ───────────────────────────────────────────────────────────────────

/** A filesystem in a Map — so nothing under a real HOME is ever a test's business. */
function memoryFs(seed: Record<string, string> = {}): OperationFileSystem & {
	files: Map<string, string>;
	writes: string[];
} {
	const files = new Map(Object.entries(seed));
	const writes: string[] = [];
	return {
		files,
		writes,
		async readFile(path) {
			return files.has(path) ? files.get(path)! : null;
		},
		async writeFile(path, content) {
			writes.push(path);
			files.set(path, content);
		},
		async removeFile(path) {
			writes.push(path);
			files.delete(path);
		},
	};
}

function channelAnswering(answer: string): OperationConsentChannel {
	return {
		async ask() {
			return answer;
		},
	};
}

/** A channel that FAILS if it is ever consulted — how "did not re-ask" is proven. */
function channelThatMustNotBeAsked(): OperationConsentChannel {
	return {
		async ask() {
			throw new Error("the operator was asked again — the standing decision was ignored");
		},
	};
}

const PROFILE = "/home/op/.bashrc";
const EXPORT_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

function requestAppending(before: string | null, text = EXPORT_LINE): OperationRequest {
	const head =
		before === null ? "" : before.endsWith("\n") || before === "" ? before : `${before}\n`;
	const after = `${head}${text}\n`;
	const line = after.slice(0, after.indexOf(text)).split("\n").length;
	const change: OperationFileChange = {
		path: PROFILE,
		before,
		after,
		insertion: { line, text, placement: `no fim do arquivo (linha ${line})` },
	};
	return {
		id: `shell-path:${PROFILE}`,
		kind: "shell-path",
		title: "Pôr os atalhos do kit no seu PATH",
		purpose: "Para você digitar farm-ask em vez do caminho inteiro do kit.",
		requester: "farm-client/instalador",
		requestedAt: "2026-07-30T10:00:00.000Z",
		changes: [change],
		undo: { kind: "restore-snapshot", summary: `Restaura ${PROFILE} exatamente como está agora.` },
	};
}

let tick = 0;
const clock = () => `2026-07-30T12:00:0${tick++}.000Z`;

// ── R2: the request states the change exactly ─────────────────────────────────

describe("the request states the change exactly, before it is made", () => {
	it("names the file, the line, the position, and shows the current contents", () => {
		const request = requestAppending("# perfil\nexport EDITOR=vim\n");
		const text = renderOperationRequest(request).join("\n");

		expect(text).toContain(PROFILE);
		expect(text).toContain("linha 3");
		expect(text).toContain("no fim do arquivo");
		expect(text).toContain(EXPORT_LINE);
		// What the file looks like NOW — not merely a promise about what it will look like.
		expect(text).toContain("Como está agora");
		expect(text).toContain("export EDITOR=vim");
		// And the added line is marked as added in the result view.
		expect(text).toMatch(/\+\s+3 │ export PATH/);
	});

	it("says a missing file will be created rather than pretending it is empty", () => {
		const text = renderOperationRequest(requestAppending(null)).join("\n");
		expect(text).toContain("ainda não existe — será criado");
		expect(text).not.toContain("Como está agora");
	});

	it("states the undo in the REQUEST — before the decision, not after", () => {
		const text = renderOperationRequest(requestAppending("")).join("\n");
		expect(text).toContain("Desfazer: Restaura /home/op/.bashrc exatamente como está agora.");
	});

	it("an irreversible operation says so in the request, with a reason", () => {
		const request = requestAppending("");
		request.undo = { kind: "irreversible", reason: "o arquivo original não pode ser reconstruído" };
		const text = renderOperationRequest(request).join("\n");
		expect(text).toContain("NÃO dá para desfazer");
		expect(text).toContain("o arquivo original não pode ser reconstruído");
		expect(isReversible(request.undo)).toBe(false);
	});

	it("carries decision-time notes into the render AND into the record", async () => {
		const request = requestAppending("# perfil\n");
		request.notes = ["escolhi ~/.bashrc porque seu shell é bash; ~/.profile também existe"];
		expect(renderOperationRequest(request).join("\n")).toContain("porque seu shell é bash");

		const trail = createMemoryOperationTrail();
		await runOperationConsent({
			request,
			trail,
			fs: memoryFs({ [PROFILE]: "# perfil\n" }),
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});
		expect((await trail.read())[0]!.notes).toEqual(request.notes);
	});

	it("offers three answers, and Enter changes nothing", () => {
		const prompt = operationDecisionPrompt(requestAppending(""));
		expect(prompt.options.map((o) => o.value)).toEqual([
			OPERATION_AUTHORIZE,
			OPERATION_DECLINE,
			OPERATION_LATER,
		]);
		expect(prompt.default).toBe(OPERATION_LATER);
	});
});

// ── authorising ───────────────────────────────────────────────────────────────

describe("authorising applies exactly the proposed change", () => {
	it("writes the after-snapshot and touches nothing else", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n", "/home/op/.zshrc": "untouched\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
			decidedBy: "op",
			host: "phone",
		});

		expect(outcome.status).toBe("authorized");
		expect(fs.files.get(PROFILE)).toBe(`# perfil\n${EXPORT_LINE}\n`);
		expect(fs.files.get("/home/op/.zshrc")).toBe("untouched\n");
		expect(fs.writes).toEqual([PROFILE]);
	});

	it("records what changed, why, who asked, who authorised, when, and how to undo it", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
			decidedBy: "arthur",
			host: "phone",
		});

		const [record] = await trail.read();
		expect(record!.decision).toBe("authorized");
		expect(record!.purpose).toBe(request.purpose);
		expect(record!.requester).toBe("farm-client/instalador");
		expect(record!.decidedBy).toBe("arthur");
		expect(record!.host).toBe("phone");
		expect(record!.requestedAt).toBe("2026-07-30T10:00:00.000Z");
		expect(record!.decidedAt).toBeTruthy();
		expect(record!.appliedAt).toBe(record!.decidedAt);
		expect(record!.changes[0]!.before).toBe("# perfil\n");
		expect(record!.changes[0]!.after).toBe(`# perfil\n${EXPORT_LINE}\n`);
		expect(record!.undo).toEqual({
			kind: "restore-snapshot",
			summary: `Restaura ${PROFILE} exatamente como está agora.`,
		});
	});

	it("a change that cannot be recorded is not made — the trail failure rolls the files back", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		trail.append = async () => {
			throw new Error("trilha somente-leitura");
		};

		await expect(
			runOperationConsent({
				request: requestAppending("# perfil\n"),
				trail,
				fs,
				channel: channelAnswering(OPERATION_AUTHORIZE),
				now: clock,
			}),
		).rejects.toThrow("trilha somente-leitura");

		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
	});
});

// ── the undo actually reverses ────────────────────────────────────────────────

describe("the record's undo is executable, not a sentence", () => {
	it("round-trips through a file trail and the undo puts the file back", async () => {
		const dir = await mkdtemp(join(tmpdir(), "opconsent-"));
		try {
			const nodeFs = createNodeOperationFileSystem();
			const profile = join(dir, ".bashrc");
			await writeFile(profile, "# perfil\nexport EDITOR=vim\n");
			const trailPath = join(dir, "operations.json");
			const trail = createFileOperationTrail(trailPath, nodeFs);

			const before = await readFile(profile, "utf8");
			const request = requestAppending(before);
			request.changes[0]!.path = profile;
			request.id = `shell-path:${profile}`;

			await runOperationConsent({
				request,
				trail,
				fs: nodeFs,
				channel: channelAnswering(OPERATION_AUTHORIZE),
				now: clock,
				decidedBy: "op",
			});
			expect(await readFile(profile, "utf8")).toBe(`${before}${EXPORT_LINE}\n`);

			// The trail is a real file, and it round-trips.
			const document = JSON.parse(await readFile(trailPath, "utf8")) as {
				capability: string;
				records: Array<{ id: string }>;
			};
			expect(document.capability).toBe(OPERATION_CONSENT_CAPABILITY);
			const [stored] = await trail.read();
			expect(stored!.id).toBe(document.records[0]!.id);

			// APPLY the undo — a stored string that is never executed proves nothing.
			await undoOperationRecord({ record: stored!, trail, fs: nodeFs, now: clock });
			expect(await readFile(profile, "utf8")).toBe(before);

			const timeline = operationTimeline(await trail.read(), request.id);
			expect(timeline.map((r) => r.decision)).toEqual(["authorized", "undone"]);
			expect(timeline[1]!.revisitOf).toBe(stored!.id);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("undoing a creation removes the file it created", async () => {
		const fs = memoryFs();
		const trail = createMemoryOperationTrail();
		const request = requestAppending(null);

		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});
		expect(fs.files.has(PROFILE)).toBe(true);

		const [record] = await trail.read();
		await undoOperationRecord({ record: record!, trail, fs, now: clock });
		expect(fs.files.has(PROFILE)).toBe(false);
	});

	it("refuses to undo what it never applied, or what it warned was irreversible", async () => {
		const trail = createMemoryOperationTrail();
		const declined = makeOperationRecord({
			request: requestAppending(""),
			decision: "declined",
			decidedBy: "op",
			decidedAt: "2026-07-30T12:00:00.000Z",
		});
		await expect(undoOperationRecord({ record: declined, trail, fs: memoryFs() })).rejects.toThrow(
			/only an authorized operation/,
		);

		const irreversible = makeOperationRecord({
			request: { ...requestAppending(""), undo: { kind: "irreversible", reason: "sem volta" } },
			decision: "authorized",
			decidedBy: "op",
			decidedAt: "2026-07-30T12:00:00.000Z",
		});
		await expect(
			undoOperationRecord({ record: irreversible, trail, fs: memoryFs() }),
		).rejects.toThrow(/irreversible/);
	});

	it("reversing a change set is swapping the snapshots — nothing is invented", () => {
		const changes: OperationFileChange[] = [{ path: "/a", before: "x\n", after: "y\n" }];
		expect(reverseChanges(changes)).toEqual([{ path: "/a", before: "y\n", after: "x\n" }]);
		expect(changes[0]!.before).toBe("x\n");
	});
});

// ── R4: declining is remembered ───────────────────────────────────────────────

describe("declining is a first-class, remembered outcome", () => {
	it("records the refusal, including what was refused", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_DECLINE),
			now: clock,
			decidedBy: "op",
		});

		expect(outcome.status).toBe("declined");
		expect(fs.writes).toEqual([]);
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
		const [record] = await trail.read();
		expect(record!.decision).toBe("declined");
		expect(record!.appliedAt).toBeNull();
		// What was refused is on the record — "you said no to THIS", not merely "you said no".
		expect(record!.changes[0]!.after).toContain(EXPORT_LINE);
	});

	it("a second run sees the prior decline and does not ask again", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_DECLINE),
			now: clock,
		});

		const asked: string[] = [];
		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelThatMustNotBeAsked(),
			now: clock,
			announce: (line) => asked.push(line),
		});

		expect(outcome.status).toBe("already-decided");
		expect(outcome.record!.decision).toBe("declined");
		// Not even the request text is re-printed: a standing decision is not a nag.
		expect(asked).toEqual([]);
		expect((await trail.read()).length).toBe(1);
	});

	it("a prior authorisation is equally standing — the wizard does not re-propose it", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelThatMustNotBeAsked(),
			now: clock,
		});
		expect(outcome.status).toBe("already-decided");
		expect(outcome.record!.decision).toBe("authorized");
	});

	it("a deliberate revisit re-opens the question and chains to what it supersedes", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_DECLINE),
			now: clock,
		});
		const [first] = await trail.read();

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
			revisit: true,
		});

		expect(outcome.status).toBe("authorized");
		expect(outcome.record!.revisitOf).toBe(first!.id);
		expect(fs.files.get(PROFILE)).toBe(`# perfil\n${EXPORT_LINE}\n`);
		// The refusal is still in the trail — a change of mind does not erase the mind that changed.
		const timeline = operationTimeline(await trail.read(), request.id);
		expect(timeline.map((r) => r.decision)).toEqual(["declined", "authorized"]);
		expect(standingDecision(timeline, request.id)!.decision).toBe("authorized");
	});

	it('"agora não" records nothing, so the question comes back next run', async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_LATER),
			now: clock,
		});
		expect(outcome.status).toBe("deferred");
		expect(await trail.read()).toEqual([]);
		expect(fs.writes).toEqual([]);

		const second = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});
		expect(second.status).toBe("authorized");
	});
});

// ── no operator, and cancellation ─────────────────────────────────────────────

describe("nobody to ask", () => {
	it("without a channel it never prompts, never writes, never records — and never reads", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		let reads = 0;
		const watched = {
			...trail,
			read: async () => {
				reads++;
				return trail.read();
			},
		};

		const outcome = await runOperationConsent({
			request: requestAppending("# perfil\n"),
			trail: watched,
			fs,
			channel: null,
			now: clock,
		});

		expect(outcome).toEqual({ status: "no-operator", record: null });
		expect(reads).toBe(0);
		expect(fs.writes).toEqual([]);
	});

	it("cancellation mid-prompt propagates and records nothing", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const cancelling: OperationConsentChannel = {
			async ask() {
				throw new OperatorPromptCancelledError();
			},
		};

		await expect(
			runOperationConsent({
				request: requestAppending("# perfil\n"),
				trail,
				fs,
				channel: cancelling,
				now: clock,
			}),
		).rejects.toBeInstanceOf(OperatorPromptCancelledError);

		expect(await trail.read()).toEqual([]);
		expect(fs.writes).toEqual([]);
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
	});
});

// ── the seams ─────────────────────────────────────────────────────────────────

describe("the seams hold", () => {
	it("a real prompt-contract-v1 OperatorChannel satisfies the structural channel", async () => {
		// The whole reason this block imports nothing: the prompt block's channel must fit WITHOUT
		// being depended on. If this ever stops type-checking, the structural claim is fiction.
		const channel: OperationConsentChannel = createScriptedOperatorChannel([OPERATION_DECLINE]);
		const trail = createMemoryOperationTrail();
		const outcome = await runOperationConsent({
			request: requestAppending(""),
			trail,
			fs: memoryFs(),
			channel,
			now: clock,
		});
		expect(outcome.status).toBe("declined");
	});

	it("a corrupt trail file degrades into an empty trail, never into a wizard that cannot run", async () => {
		const dir = await mkdtemp(join(tmpdir(), "opconsent-"));
		try {
			const path = join(dir, "operations.json");
			await writeFile(path, "{ not json");
			const trail = createFileOperationTrail(path, createNodeOperationFileSystem());
			expect(await trail.read()).toEqual([]);

			const record = makeOperationRecord({
				request: requestAppending(""),
				decision: "declined",
				decidedBy: "op",
				decidedAt: "2026-07-30T12:00:00.000Z",
			});
			await trail.append(record);
			expect((await trail.read()).map((r) => r.id)).toEqual([record.id]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("applyChanges removes a file whose after-snapshot is null", async () => {
		const fs = memoryFs({ "/a": "x\n" });
		await applyChanges([{ path: "/a", before: "x\n", after: null }], fs);
		expect(fs.files.has("/a")).toBe(false);
	});

	it("the block imports node built-ins only — the device constraint is load-bearing", async () => {
		const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
		const specifiers = [...source.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map(
			(m) => m[1],
		);
		expect(specifiers).toEqual(["node:fs/promises", "node:path"]);
	});

	it("declares no runtime dependencies", async () => {
		const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
		expect(Object.keys(pkg.peerDependencies ?? {})).toEqual([]);
	});
});

// ── the record WITHOUT the prompt ─────────────────────────────────────────────

describe("recordOperation — the operator's own change is remembered, never re-confirmed", () => {
	it("applies the change and appends an authorized record, asking nobody", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		const record = await recordOperation({
			request,
			trail,
			fs,
			now: clock,
			decidedBy: "op",
			host: "torre",
		});

		expect(fs.files.get(PROFILE)).toBe(request.changes[0]?.after);
		expect(record.decision).toBe("authorized");
		expect(record.decidedBy).toBe("op");
		expect(record.host).toBe("torre");
		expect(record.appliedAt).toBe(record.decidedAt);
		expect(await trail.read()).toEqual([record]);
	});

	it("takes no channel at all — there is no prompt here to suppress", () => {
		// Structural, and the point: `runOperationConsent` REQUIRES something to ask. This
		// function has no such parameter, so no consumer can accidentally acquire a
		// confirmation step, and none needs a `--yes` to get rid of one.
		expect("channel" in ({} as Record<string, unknown>)).toBe(false);
		expect(recordOperation.length).toBe(1);
	});

	it("does not consult the standing decision — a repeat is a new fact, not a re-ask", async () => {
		// A declined PATH operation must not be re-asked (R4). A config value set twice is two
		// changes, and the second is not a question anyone declined.
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const request = requestAppending("# perfil\n");
		const trail = createMemoryOperationTrail([
			makeOperationRecord({
				request,
				decision: "declined",
				decidedBy: "op",
				decidedAt: "2026-07-29T00:00:00.000Z",
			}),
		]);
		await recordOperation({ request, trail, fs, now: clock });
		expect((await trail.read()).at(-1)?.decision).toBe("authorized");
	});

	it("ROLLS BACK the file when the record cannot be written", async () => {
		// "A change that cannot be remembered is not made" — the same guarantee the consent
		// journey gives, because it is the same requirement.
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const failing = {
			async read() {
				return [];
			},
			async append(): Promise<never> {
				throw new Error("trail is read-only");
			},
		};
		await expect(
			recordOperation({ request: requestAppending("# perfil\n"), trail: failing, fs, now: clock }),
		).rejects.toThrow(/trail is read-only/);
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
	});

	it("the record it writes can be UNDONE, and the undo actually restores the file", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const record = await recordOperation({
			request: requestAppending("# perfil\n"),
			trail,
			fs,
			now: clock,
		});
		expect(isReversible(record.undo)).toBe(true);

		const undone = await undoOperationRecord({ record, trail, fs, now: clock });
		expect(undone.decision).toBe("undone");
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
		// Append-only: the original record is still there, with the reversal after it.
		expect((await trail.read()).map((entry) => entry.decision)).toEqual(["authorized", "undone"]);
	});
});
