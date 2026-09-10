import {
	createMessageTranslator,
	resolveLocale,
	type MessageTranslator,
} from "@refarm.dev/localization-v1";
import type { OperationRefusal } from "./client.js";
import type { OperationRun } from "./wire.js";

const catalogs = {
	en: {
		title: "Operations",
		empty: "This node has no operation admitted for remote start.",
		start: "Start",
		details: "Details",
		refresh: "Refresh operations",
		loading: "Loading admitted operations…",
		starting: "Starting…",
		running: "Running",
		succeeded: "Completed",
		failed: "Failed",
		cancelled: "Abandoned",
		cancel: "Abandon",
		cancelling: "Abandoning…",
		unauthorized: "This session is not authorised for operations. Verify it again at the node.",
		"already-running":
			"Another remotely started operation is still running. Attend it before starting another.",
		"unknown-operation": "This operation is no longer admitted by the node.",
		"not-remotely-invocable": "This command exists, but is closed to remote surfaces.",
		"unknown-run": "This node no longer retains that run.",
		unavailable: "The node could not be reached.",
		"invalid-response": "The node returned an operation response this surface does not understand.",
	},
	"pt-BR": {
		title: "Operações",
		empty: "Este nó não tem nenhuma operação admitida para início remoto.",
		start: "Iniciar",
		details: "Detalhes",
		refresh: "Atualizar operações",
		loading: "Carregando operações admitidas…",
		starting: "Iniciando…",
		running: "Em execução",
		succeeded: "Concluída",
		failed: "Falhou",
		cancelled: "Abandonada",
		cancel: "Abandonar",
		cancelling: "Abandonando…",
		unauthorized: "Esta sessão não está autorizada para operações. Verifique-a novamente no nó.",
		"already-running":
			"Outra operação iniciada remotamente ainda está em execução. Atenda-a antes de iniciar outra.",
		"unknown-operation": "Esta operação não está mais admitida pelo nó.",
		"not-remotely-invocable": "Este comando existe, mas está fechado para superfícies remotas.",
		"unknown-run": "Este nó não retém mais essa execução.",
		unavailable: "Não foi possível alcançar o nó.",
		"invalid-response": "O nó retornou uma resposta de operação que esta superfície não reconhece.",
	},
	es: {
		title: "Operaciones",
		empty: "Este nodo no tiene operaciones admitidas para inicio remoto.",
		start: "Iniciar",
		details: "Detalles",
		refresh: "Actualizar operaciones",
		loading: "Cargando operaciones admitidas…",
		starting: "Iniciando…",
		running: "En ejecución",
		succeeded: "Completada",
		failed: "Falló",
		cancelled: "Abandonada",
		cancel: "Abandonar",
		cancelling: "Abandonando…",
		unauthorized:
			"Esta sesión no está autorizada para operaciones. Verifíquela de nuevo en el nodo.",
		"already-running":
			"Otra operación iniciada remotamente sigue en ejecución. Atiéndala antes de iniciar otra.",
		"unknown-operation": "Esta operación ya no está admitida por el nodo.",
		"not-remotely-invocable": "Este comando existe, pero está cerrado para superficies remotas.",
		"unknown-run": "Este nodo ya no conserva esa ejecución.",
		unavailable: "No se pudo alcanzar el nodo.",
		"invalid-response":
			"El nodo devolvió una respuesta de operación que esta superficie no reconoce.",
	},
} as const;

export function createOperationMessages(candidates: readonly string[]): MessageTranslator {
	return createMessageTranslator({ locale: resolveLocale(candidates), catalogs });
}

export function describeOperationRefusal(
	messages: MessageTranslator,
	refusal: OperationRefusal,
): string {
	const base = messages.t(refusal.kind);
	return refusal.detail ? `${base} ${refusal.detail}` : base;
}

export function describeOperationRun(messages: MessageTranslator, run: OperationRun): string {
	const suffix = run.exitCode === null ? "" : ` (exit ${run.exitCode})`;
	const lifecycle = `${messages.t(run.state)}${suffix}`;
	if (run.result) {
		const metrics = run.result.metrics.map(
			(metric) => `${metric.name}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`,
		);
		const findings = run.result.findings.map(
			(finding) => `• ${finding.summary}${finding.location ? ` — ${finding.location}` : ""}`,
		);
		return [lifecycle, run.result.summary, ...metrics, ...findings].join("\n");
	}
	return run.resultError
		? `${lifecycle}\noperation-result.v1: ${run.resultError}`
		: lifecycle;
}
