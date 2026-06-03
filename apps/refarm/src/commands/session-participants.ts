import { isRuntimeAgentPluginId } from "@refarm.dev/config";

const AGENT_PARTICIPANT_PREFIX = "urn:refarm:agent:";
const RUNTIME_AGENT_PARTICIPANT_ID = `${AGENT_PARTICIPANT_PREFIX}runtime-agent`;

export interface SessionParticipantAlias {
	participantId: string;
	canonicalParticipantId: string;
}

export interface SessionParticipantFields {
	canonicalParticipants?: string[];
	participantAliases?: SessionParticipantAlias[];
}

export function canonicalSessionParticipantId(participantId: string): string {
	const agentId = participantId.startsWith(AGENT_PARTICIPANT_PREFIX)
		? participantId.slice(AGENT_PARTICIPANT_PREFIX.length)
		: participantId;
	return isRuntimeAgentPluginId(agentId)
		? RUNTIME_AGENT_PARTICIPANT_ID
		: participantId;
}

export function sessionParticipantFields(
	participants: readonly string[] | undefined,
): SessionParticipantFields {
	if (!participants || participants.length === 0) return {};
	const canonicalParticipants = participants.map(canonicalSessionParticipantId);
	const participantAliases = participants
		.map((participantId, index): SessionParticipantAlias | null => {
			const canonicalParticipantId = canonicalParticipants[index]!;
			return participantId === canonicalParticipantId
				? null
				: { participantId, canonicalParticipantId };
		})
		.filter((alias): alias is SessionParticipantAlias => alias !== null);
	return {
		canonicalParticipants,
		...(participantAliases.length > 0 ? { participantAliases } : {}),
	};
}
