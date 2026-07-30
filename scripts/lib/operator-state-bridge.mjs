/**
 * Bridge resiliente para o contrato compartilhado de operator-state.
 *
 * Preferimos resolver pelo nome do pacote quando o workspace estiver linkado,
 * mas mantemos fallback local para execucao direta dos scripts no checkout.
 */
const OPERATOR_STATE_DIST_URL = new URL("../../packages/operator-state/dist/index.js", import.meta.url);

async function loadOperatorStateModule() {
	try {
		return await import("@refarm.dev/operator-state");
	} catch (packageError) {
		try {
			return await import(OPERATOR_STATE_DIST_URL.href);
		} catch (distError) {
			throw new Error(
				"Nao foi possivel carregar o contrato @refarm.dev/operator-state nem o fallback local em packages/operator-state/dist.",
				{ cause: { packageError, distError } },
			);
		}
	}
}

const operatorStateModule = await loadOperatorStateModule();

export const {
	buildOperatorAttentionGateCommands,
	buildOperatorAttentionGateHandoff,
} = operatorStateModule;
