import type { OperationFileSystem, OperationRequest } from "@refarm.dev/operation-consent-v1";
import { SupervisionRefusal } from "@refarm.dev/process-contract-v1";

import type { CommandRunner } from "./runner.js";

/**
 * W3 — the limitation, stated rather than omitted.
 *
 * Measured on the operator's node: `loginctl show-user … Linger=no`. A `systemd --user` unit
 * therefore **stops when they log out**, and comes back only when they log in again. A proposal
 * that says "I will keep this running" while leaving that out has told a useful-sounding untruth —
 * and the operator would discover it exactly once, at the worst possible moment, when a phone
 * running `farm-update` gets nothing because nobody was logged into the node.
 *
 * So lingering is offered as a SEPARATE, SEPARATELY-AUTHORISED operation. Never bundled: bundling
 * is how a small yes becomes a large one, and this particular large one means "processes of mine
 * keep running on this machine while I am not there", which is a different thing to agree to than
 * "write this unit file".
 *
 * {@link refuseBundledLinger} enforces that structurally, in both directions, so the rule survives
 * a future edit that would find bundling convenient.
 */

/** Where systemd records that a user may linger. Present ⇒ enabled. */
export const LINGER_DIR = "/var/lib/systemd/linger";

export function lingerMarkerPath(user: string): string {
	return `${LINGER_DIR}/${user}`;
}

/** `unknown` is a first-class answer: not being able to ask is not the same as being told "no". */
export type LingerState = "enabled" | "disabled" | "unknown";

export const LINGER_OPERATION_KIND = "user-linger";
export const PROCESS_UNIT_OPERATION_KIND = "process-unit";

/** Ask `loginctl` whether this user lingers. Never throws — a failure is `unknown`. */
export async function readLingerState(
	runner: CommandRunner,
	user: string,
): Promise<{ state: LingerState; detail: string }> {
	const result = await runner.run("loginctl", ["show-user", user, "--property=Linger"]);
	if (!result.spawned) {
		return {
			state: "unknown",
			detail: `loginctl could not be run (${result.stderr || "not found"}), so refarm cannot say whether "${user}" lingers`,
		};
	}
	const value = /^Linger=(.*)$/m.exec(result.stdout)?.[1]?.trim();
	if (value === "yes") return { state: "enabled", detail: `lingering is enabled for "${user}"` };
	if (value === "no") return { state: "disabled", detail: `lingering is off for "${user}"` };
	return {
		state: "unknown",
		detail: `loginctl did not report a Linger property for "${user}" (exit ${result.code})`,
	};
}

/**
 * What lifetime a unit ACTUALLY has on this host, in one sentence the operator can act on.
 *
 * This is the sentence W3 exists to force into the proposal. It changes with the measured state and
 * never claims more than the state supports.
 */
export function describeUnitLifetime(state: LingerState, user: string): string {
	switch (state) {
		case "enabled":
			return (
				`Lifetime: this starts at boot and KEEPS RUNNING after you log out — lingering is ` +
				`already enabled for "${user}".`
			);
		case "disabled":
			return (
				`Lifetime: this starts when you log in and STOPS WHEN YOU LOG OUT. Lingering is off for ` +
				`"${user}", so it does not survive a logout and does not come back at boot until you log ` +
				`in again. Making it survive is a SEPARATE operation you authorise separately: ` +
				`\`refarm process linger\`.`
			);
		case "unknown":
			return (
				`Lifetime: refarm could not read the lingering state for "${user}", so it does NOT know ` +
				`whether this survives a logout — and will not guess. \`loginctl show-user ${user} ` +
				`--property=Linger\` answers it.`
			);
	}
}

export interface LingerRequestInput {
	user: string;
	/** What the operator gains, in their terms — named by the caller so the reason is concrete. */
	purpose?: string;
	requester: string;
	requestedAt: string;
	/** The measured state, so the request never proposes what is already true. */
	current: LingerState;
}

/**
 * The linger operation, as its OWN request with its own id, its own kind and its own decision.
 *
 * The change is modelled as the marker file systemd actually keeps, because that is what makes the
 * undo executable: `createLingerFileSystem` turns the write into `loginctl enable-linger` and the
 * removal into `loginctl disable-linger`, so "restore the snapshot" really does put the machine
 * back.
 */
export function buildLingerRequest(input: LingerRequestInput): OperationRequest {
	return {
		id: `${LINGER_OPERATION_KIND}:${input.user}`,
		kind: LINGER_OPERATION_KIND,
		title: `Deixar os processos de "${input.user}" continuarem rodando depois do logout (linger)`,
		purpose:
			input.purpose ??
			`Sem isso, TODA unit \`systemd --user\` deste usuário morre quando você sai da sessão — ` +
				`inclusive o \`refarm web serve\` de que o celular depende para o cold bootstrap.`,
		requester: input.requester,
		requestedAt: input.requestedAt,
		changes: [
			{
				path: lingerMarkerPath(input.user),
				before: input.current === "enabled" ? "" : null,
				after: "",
				insertion: {
					line: 1,
					text: `loginctl enable-linger ${input.user}`,
					placement:
						"o systemd marca o usuário como 'linger' criando este arquivo — refarm executa o " +
						"loginctl, não escreve o arquivo à mão",
				},
			},
		],
		undo: {
			kind: "restore-snapshot",
			summary: `\`loginctl disable-linger ${input.user}\` — os serviços voltam a parar no logout.`,
		},
		notes: [
			`O QUE MUDA: units suas passam a subir no boot, mesmo sem você entrar na máquina, e ` +
				`continuam rodando enquanto você está fora.`,
			`O QUE CUSTA: processos seus rodando sem sessão sua aberta. É uma decisão sobre a MÁQUINA, ` +
				`não sobre um serviço — vale para todas as suas units, não só a que motivou a pergunta.`,
			`É uma operação SEPARADA de propósito: instalar uma unit e passar a rodar sem você são ` +
				`coisas diferentes, e refarm não junta as duas numa pergunta só.`,
		],
	};
}

/**
 * The structural rule: a unit installation may not carry the linger change, and the linger
 * operation may not carry anything else.
 *
 * Enforced on the REQUEST, before consent runs, so the bundling cannot happen by accident in a
 * later edit — the operator's protection is a test away from being noticed, not a comment.
 */
export function refuseBundledLinger(request: OperationRequest): void {
	const touchesLinger = request.changes.some((change) => change.path.startsWith(`${LINGER_DIR}/`));
	if (request.kind === LINGER_OPERATION_KIND) {
		const other = request.changes.find((change) => !change.path.startsWith(`${LINGER_DIR}/`));
		if (other) {
			throw new SupervisionRefusal(
				"bundled-consent",
				`operation "${request.id}": a linger request may change nothing but the lingering state, ` +
					`and this one also changes ${other.path}`,
				"Split it: ask for the unit and ask for lingering as two operations.",
			);
		}
		return;
	}
	if (touchesLinger) {
		throw new SupervisionRefusal(
			"bundled-consent",
			`operation "${request.id}" (kind "${request.kind}") would also enable lingering — a small ` +
				`yes may not be turned into a large one by bundling`,
			"Ask for lingering on its own, with `refarm process linger`, so it is decided on its own.",
		);
	}
}

/**
 * The filesystem seam for the linger operation, wired to `loginctl`.
 *
 * Writing `/var/lib/systemd/linger/<user>` directly needs root; `loginctl enable-linger` goes
 * through polkit, which is the supported door. Translating the snapshot into that command is what
 * lets the linger decision live in the same journey — proposed, decided, recorded, undoable — as
 * every other change to the operator's machine.
 */
export function createLingerFileSystem(runner: CommandRunner, user: string): OperationFileSystem {
	function assertMarker(path: string): void {
		if (path !== lingerMarkerPath(user)) {
			throw new SupervisionRefusal(
				"bundled-consent",
				`the linger filesystem refuses to touch ${path} — it may only change lingering for "${user}"`,
				"Use the ordinary filesystem for ordinary files.",
			);
		}
	}
	async function loginctl(verb: string): Promise<void> {
		const result = await runner.run("loginctl", [verb, user]);
		if (!result.spawned || result.code !== 0) {
			throw new SupervisionRefusal(
				"linger-failed",
				`loginctl ${verb} ${user} failed: ${result.stderr.trim() || `exit ${result.code}`}`,
				`Run \`loginctl ${verb} ${user}\` yourself — it needs a polkit authorisation this process could not obtain.`,
			);
		}
	}
	return {
		async readFile(path) {
			assertMarker(path);
			const { state } = await readLingerState(runner, user);
			return state === "enabled" ? "" : null;
		},
		async writeFile(path) {
			assertMarker(path);
			await loginctl("enable-linger");
		},
		async removeFile(path) {
			assertMarker(path);
			await loginctl("disable-linger");
		},
	};
}
