export interface SessionIdNode {
	"@id": string;
}

export const SESSION_ID_URN_PREFIX = "urn:refarm:session:v1:";

export function isFullSessionId(value: string): boolean {
	return value.startsWith(SESSION_ID_URN_PREFIX);
}

export function formatSessionId(id: string): string {
	// urn:refarm:session:v1:0123456789abcdef → show last 12 chars
	const parts = id.split(":");
	return parts.at(-1)?.slice(-12) ?? id;
}

export function findSessionIdPrefixMatches<T extends SessionIdNode>(
	prefix: string,
	sessions: T[],
): T[] {
	const exact = sessions.find((session) => session["@id"] === prefix);
	if (exact) return [exact];

	return sessions.filter(
		(session) =>
			session["@id"].includes(prefix) || session["@id"].endsWith(prefix),
	);
}

export function resolveSessionIdPrefix<T extends SessionIdNode>(
	prefix: string,
	sessions: T[],
): string {
	const matches = findSessionIdPrefixMatches(prefix, sessions);
	if (matches.length === 0) {
		throw new Error(`No session matching "${prefix}"`);
	}
	if (matches.length > 1) {
		throw new Error(
			`Ambiguous session prefix "${prefix}" (${matches.length} matches)`,
		);
	}
	return matches[0]!["@id"];
}
