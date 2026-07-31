import type { OperationRequest } from "@refarm.dev/operation-consent-v1";

import {
	LINUX_CA_ANCHOR_DIR,
	LINUX_CA_REFRESH_COMMAND,
	normalizeNameSuffixes,
} from "./extensions.js";
import {
	certutilCommandLine,
	certutilDeleteArgs,
	describeNssStoreReach,
	nssEntryPath,
	type NssStore,
} from "./nss.js";

/**
 * T4 — trusting a CA is a change to a DEVICE, so it goes through consent.
 *
 * "Install this certificate" reads as routine setup and is not. A trusted CA can vouch for any
 * name inside its constraint, on that device, for as long as it stays installed. That is exactly
 * the class of change `@refarm.dev/operation-consent-v1` exists for, and the request must SAY so —
 * what the CA can do, which device is affected, and how to undo it — rather than present itself as
 * a setup step.
 *
 * ── WHAT THIS BLOCK DOES AND DOES NOT DECIDE ─────────────────────────────────────
 *
 * It builds the REQUEST. Where the anchor goes is the caller's (`anchorPath`), for the same reason
 * the trail's location is: a generic block that hard-codes one deployment's layout has learned
 * something it had no business knowing. {@link linuxCaAnchorPath} is offered as the Linux answer,
 * not imposed as the answer.
 *
 * The operation is the FILE placement, because that is what `applyChanges` can apply and, more to
 * the point, what it can UNDO — the undo is executable, not a sentence in a log. The trust store
 * refresh (`update-ca-certificates`) is a command, not a file, so it is stated in the request as
 * what the operator must still run, both to apply and to undo. A phone has no such command at all;
 * there the request is the honest description of a manual step, which is better than a wizard
 * pretending it can reach into a device's settings.
 */

export const CA_TRUST_OPERATION_KIND = "ca-trust" as const;

/** Where a Linux distribution keeps operator-installed anchors. Re-exported so a caller does not
 *  need to know which file in this package holds it. */
export { LINUX_CA_ANCHOR_DIR, LINUX_CA_REFRESH_COMMAND };

/** The anchor path for a CA on a Linux trust store. PURE. */
export function linuxCaAnchorPath(caName: string, anchorDir: string = LINUX_CA_ANCHOR_DIR): string {
	const slug =
		caName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9.-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "refarm";
	// `.crt` is not decoration: `update-ca-certificates` only picks up files with that extension.
	return `${anchorDir.replace(/\/+$/, "")}/${slug}.crt`;
}

export interface CaTrustRequestInput {
	/** The CA's human label, used in the title and the anchor filename. */
	caName: string;
	/** The CA CERTIFICATE, PEM. The public half — the private key is never part of this and never
	 *  leaves the node that issued it. */
	caPem: string;
	/** SHA-256 fingerprint, so the operator can compare what they are installing. */
	fingerprint: string;
	/** The suffixes this CA may vouch for. */
	nameSuffixes: readonly string[];
	/** WHICH DEVICE is being changed, in the operator's own words ("this laptop", "the phone"). */
	device: string;
	/** Where the anchor is written on that device. */
	anchorPath: string;
	/** What is already at `anchorPath`, or `null` when nothing is. The request shows the file as it
	 *  is RIGHT NOW, which is what makes it a diff rather than a category. */
	existingPem?: string | null;
	/** WHO is asking. */
	requester: string;
	/** ISO-8601, injected — no ambient clock. */
	requestedAt: string;
	/** The command that makes this device's trust store notice the change. `null` for a device
	 *  (a phone) where there is no such command and the step is manual. */
	refreshCommand?: string | null;
	/** Why the operator wants this at all — carried verbatim into the record. */
	purpose?: string;
}

/** WHICH STORE is being changed, and how far a grant in it reaches. Absent ⇒ the change is the
 *  device's own system trust store, which is what the plain grant already describes. */
export interface CaGrantSurface {
	/** The store, in the operator's terms ("Chrome/Chromium", 'Firefox — perfil "default"'). */
	label: string;
	/** Where that store lives, so the sentence names a thing they can look at. */
	location: string;
	/** What reads it. */
	reaches: readonly string[];
	/** What keeps reading something else. */
	doesNotReach: readonly string[];
}

/**
 * The grant, in plain words. Returned separately from the request so a JSON envelope, a TUI pane
 * and the rendered request can all show the SAME sentences — a grant re-worded per surface is a
 * grant the operator has to read twice to check it is the same one. PURE.
 *
 * ── WHY REACH IS PART OF THE GRANT ───────────────────────────────────────────────
 *
 * A device has more than one trust store, and they do not see each other. Trusting a CA in
 * Chrome's NSS database does NOT make `curl` or `node` trust it, and trusting it in one Firefox
 * profile does not reach another. An operator told only "this device will trust it" has been told
 * something false, and will discover it later at a `curl` that fails for no visible reason.
 * {@link CaGrantSurface} makes that boundary part of what they authorise rather than part of what
 * they find out.
 */
export function describeCaGrant(input: {
	caName: string;
	fingerprint: string;
	nameSuffixes: readonly string[];
	device: string;
	refreshCommand?: string | null;
	surface?: CaGrantSurface;
}): string[] {
	const suffixes = normalizeNameSuffixes(input.nameSuffixes);
	const scope = suffixes.length > 0 ? suffixes.join(", ") : "(no constraint — refuse this)";
	const where = input.surface ? `${input.surface.label} em "${input.device}"` : `"${input.device}"`;
	return [
		`O QUE ISTO PERMITE: depois disto, ${where} vai aceitar como legítimo QUALQUER ` +
			`certificado assinado por esta autoridade para um nome sob ${scope}. Não é só esta página: ` +
			"é todo nome dentro dessa restrição, para qualquer serviço, até você remover a confiança.",
		...(input.surface
			? [
					`QUAL REPOSITÓRIO MUDA: ${input.surface.label}, em ${input.surface.location}. ` +
						`ALCANÇA: ${input.surface.reaches.join("; ")}.`,
					`ATÉ ONDE NÃO VAI: ${input.surface.doesNotReach.join("; ")}.`,
				]
			: []),
		`QUAL DISPOSITIVO MUDA: só "${input.device}". A confiança é local dele — nenhum outro ` +
			"dispositivo é afetado por esta autorização, e cada um precisa da sua.",
		"NÃO SAI DAQUI A CHAVE PRIVADA: só o certificado público é instalado. A chave da autoridade " +
			"fica no nó que a emitiu, em modo 0600, e não é copiada para dispositivo nenhum.",
		`CONFERE A IMPRESSÃO DIGITAL antes de aceitar: sha256 ${input.fingerprint}`,
		"O LIMITE É REAL, MAS NÃO É GARANTIA: a restrição de nomes (nameConstraints) está no " +
			"certificado e é respeitada por OpenSSL e Firefox; ALGUMAS plataformas — em especial " +
			"vários repositórios de confiança de celular — simplesmente não avaliam essa restrição em " +
			"CAs instaladas pelo usuário. Onde não avaliam, a autoridade vale para qualquer nome. " +
			"É uma redução de risco, não uma garantia.",
		"A PONTA SOLTA QUE NENHUM DESENHO RESOLVE: confiança em CA é local do dispositivo e NÃO " +
			"pode ser revogada remotamente. Para desfazer, é preciso ir nas configurações daquele " +
			"dispositivo. É exatamente por isso que a restrição de nomes importa.",
		...(input.refreshCommand
			? [`PARA VALER, ainda falta rodar: ${input.refreshCommand}`]
			: input.surface
				? [
						"NÃO PEDE PRIVILÉGIO E NÃO FALTA COMANDO NENHUM: este repositório é seu, o refarm " +
							`escreve direto em ${input.surface.location}. Feche e reabra o navegador para ele ` +
							"reler o repositório.",
					]
				: [
						"NESTE DISPOSITIVO NÃO HÁ COMANDO: a instalação é manual, nas configurações de " +
							"segurança — e a remoção também.",
					]),
	];
}

/**
 * The proposed operation: place this CA's public certificate in the device's trust anchors.
 *
 * `id` is the operation's IDENTITY, never a nonce: `ca-trust:<device>:<fingerprint>`. Asking again
 * about the same CA on the same device is the SAME question, so a prior decline is recognised
 * instead of re-asked — and a DIFFERENT CA (a rotation) is a different question, which is right,
 * because trusting a new authority is a new grant.
 */
export function buildCaTrustRequest(input: CaTrustRequestInput): OperationRequest {
	const suffixes = normalizeNameSuffixes(input.nameSuffixes);
	const refreshCommand =
		input.refreshCommand === undefined ? LINUX_CA_REFRESH_COMMAND : input.refreshCommand;
	const undoSteps = [
		`apaga ${input.anchorPath}`,
		...(refreshCommand ? [`roda \`${refreshCommand} --fresh\``] : ["remove nas configurações"]),
	];
	return {
		id: `${CA_TRUST_OPERATION_KIND}:${input.device}:${input.fingerprint}`,
		kind: CA_TRUST_OPERATION_KIND,
		title: `Confiar na autoridade certificadora "${input.caName}" em "${input.device}"`,
		purpose:
			input.purpose ??
			`Para que o navegador de "${input.device}" trate https://<nó> como origem segura — sem ` +
				"isso o `crypto.subtle` não roda e a página do refarm não consegue emitir credencial.",
		requester: input.requester,
		requestedAt: input.requestedAt,
		changes: [
			{
				path: input.anchorPath,
				before: input.existingPem ?? null,
				after: input.caPem,
				insertion: {
					line: 1,
					text: `# CA "${input.caName}" — sha256 ${input.fingerprint}\n# vale para: ${
						suffixes.join(", ") || "(sem restrição)"
					}`,
					placement: "o arquivo inteiro é o certificado público da autoridade",
				},
			},
		],
		undo: {
			kind: "restore-snapshot",
			summary:
				`Para desfazer: ${undoSteps.join(" e ")}. Isso remove a confiança NESTE ` +
				"dispositivo e em nenhum outro — não existe revogação remota.",
		},
		notes: describeCaGrant({
			caName: input.caName,
			fingerprint: input.fingerprint,
			nameSuffixes: suffixes,
			device: input.device,
			refreshCommand,
		}),
	};
}

export interface NssCaTrustRequestInput {
	caName: string;
	caPem: string;
	fingerprint: string;
	nameSuffixes: readonly string[];
	/** WHICH DEVICE, in the operator's own words — the store is on it, and only on it. */
	device: string;
	/** WHICH STORE. */
	store: NssStore;
	/** The nickname the CA is filed under, and the one the undo deletes. */
	nickname: string;
	/** The PEM already filed under that nickname, or `null` when nothing is. */
	existingPem?: string | null;
	requester: string;
	requestedAt: string;
	purpose?: string;
}

/**
 * The proposed operation for a BROWSER's own trust store — the same grant, at the smallest reach
 * that opens the page.
 *
 * ── WHY THIS IS A SEPARATE REQUEST AND NOT A FLAG ────────────────────────────────
 *
 * The `id` carries the store: `ca-trust:<device>:<store>:<fingerprint>`. Trusting a CA in Chrome
 * and trusting it in a Firefox profile are two different grants over two different surfaces, so
 * they are two different questions — declining one must not be read as declining the other, and
 * authorising one must not silently cover the other. Several Firefox profiles are several
 * questions for exactly the same reason.
 *
 * The change's path is the ENTRY ({@link nssEntryPath}), which is what makes the undo executable:
 * reversing the recorded snapshots hands `after: null` to the certutil-backed filesystem, and that
 * runs `certutil -D`. The summary states that command anyway, because an operator must be able to
 * undo this without refarm.
 */
export function buildNssCaTrustRequest(input: NssCaTrustRequestInput): OperationRequest {
	const suffixes = normalizeNameSuffixes(input.nameSuffixes);
	const reach = describeNssStoreReach(input.store);
	const undoCommand = certutilCommandLine(certutilDeleteArgs(input.store.dir, input.nickname));
	return {
		id: `${CA_TRUST_OPERATION_KIND}:${input.device}:${input.store.id}:${input.fingerprint}`,
		kind: CA_TRUST_OPERATION_KIND,
		title:
			`Confiar na autoridade certificadora "${input.caName}" em ${input.store.label} ` +
			`(${input.store.dir}) — sem privilégio`,
		purpose:
			input.purpose ??
			`Para que ${input.store.label} trate https://<nó> como origem segura — sem isso o ` +
				"`crypto.subtle` não roda e a página do refarm não consegue emitir credencial. Este " +
				"repositório é do seu usuário: não precisa de root, e o repositório do SISTEMA fica " +
				"intocado.",
		requester: input.requester,
		requestedAt: input.requestedAt,
		changes: [
			{
				path: nssEntryPath(input.store.dir, input.nickname),
				before: input.existingPem ?? null,
				after: input.caPem,
				insertion: {
					line: 1,
					text: `# CA "${input.caName}" — sha256 ${input.fingerprint}\n# vale para: ${
						suffixes.join(", ") || "(sem restrição)"
					}\n# apelido no repositório: ${input.nickname}`,
					placement:
						`a entrada inteira é o certificado público da autoridade, sob o apelido ` +
						`"${input.nickname}", marcada só como CA de TLS (${input.store.dir})`,
				},
			},
		],
		undo: {
			kind: "restore-snapshot",
			summary:
				`Para desfazer: \`${undoCommand}\` — é exatamente o que o refarm roda ao reverter este ` +
				`registro. Isso remove a confiança SÓ de ${input.store.label} neste usuário; nenhum ` +
				"outro repositório, usuário ou dispositivo é tocado, e não existe revogação remota.",
		},
		notes: describeCaGrant({
			caName: input.caName,
			fingerprint: input.fingerprint,
			nameSuffixes: suffixes,
			device: input.device,
			refreshCommand: null,
			surface: {
				label: input.store.label,
				location: input.store.dir,
				reaches: reach.reaches,
				doesNotReach: reach.doesNotReach,
			},
		}),
	};
}
