/**
 * CHANNEL TOPOLOGY — which chats, groups and handles a platform can reach.
 *
 * PROMOTED FROM `@aretw0/dgk-channels` 2026-08-28, whose ROADMAP named this package as its
 * destination. The store, the merge-by-id and the per-platform file layout are that package's.
 *
 * WHY IT IS A PACKAGE AND NOT A FIELD. A credential says WHO a channel speaks as; this says WHERE
 * it lands. One bot addresses many chats — that is the platform's own model, not a workaround —
 * so a workspace that wants its own channel declares a destination rather than minting a
 * credential. Discovering what destinations exist is the read that makes that declarable.
 *
 * WHAT WAS CHANGED IN THE PROMOTION:
 *
 *   1. NO DIRECTORY IS BAKED IN. It resolved `~/.dgk/contacts` and `<root>/.lab/contacts`, which
 *      are one consumer's layout. The caller names both bases now.
 *   2. A CORRUPT STORE IS NOT SILENTLY OVERWRITTEN. `saveContacts` merged onto whatever
 *      `loadContacts` returned, and `loadContacts` returned `[]` for an unreadable file — so a
 *      corrupt store became a store holding only the new contacts. Every previously known
 *      destination, gone, with no error. `readContacts` now reports the three states and
 *      `saveContacts` REFUSES to merge onto an unreadable one.
 *   3. THE SORT LOCALE IS THE CALLER'S. It sorted with "pt" hardcoded.
 *
 * WHAT DELIBERATELY DID NOT COME. `discoverAndSaveTelegramContacts` called Telegram's `getUpdates`
 * from inside a module that calls itself platform-agnostic. Discovery belongs beside the
 * transport that knows the protocol — in this repository, the delivery adapter, whose whole
 * boundary is that the core "never learns that a chat id, an inline keyboard or `getUpdates`
 * exist". This package stores what a transport discovers; it does not reach for it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where a store may live, when the caller wants one of the two conventional answers. */
export const CONTACTS_LOCATION_LOCAL = "local";
export const CONTACTS_LOCATION_PROJECT = "project";

/**
 * @typedef {object} Contact
 * @property {string} platform
 * @property {string} id                 The platform's own id — a chat id, a list id.
 * @property {string} [name]
 * @property {string} [type]             The platform's own kind: private, group, channel.
 * @property {string|null} [handle]
 * @property {string} [discoveredAt]
 */

/**
 * @typedef {object} ContactsRead
 * @property {"present" | "absent" | "unreadable"} state
 * @property {Contact[]} contacts
 * @property {string} file
 * @property {string} [reason]           Present only when `unreadable`.
 */

/**
 * Where a platform's contacts live.
 *
 * BOTH BASES ARE THE CALLER'S. `local` is machine-local and is the right default for topology
 * that carries real chat ids and handles; `project` puts it in a tree the caller manages, which
 * is a decision about what gets synced and is therefore not this function's to make.
 *
 * @param {object} input
 * @param {string} [input.location]   `local` | `project` | an absolute path used as-is.
 * @param {string} [input.localBase]  Directory for `local`.
 * @param {string} [input.projectBase] Directory for `project`.
 * @returns {string}
 */
export function resolveContactsDir({ location = CONTACTS_LOCATION_LOCAL, localBase, projectBase } = {}) {
	if (location === CONTACTS_LOCATION_LOCAL) {
		if (!localBase) throw new Error("resolveContactsDir: location \"local\" needs a localBase");
		return join(localBase, "contacts");
	}
	if (location === CONTACTS_LOCATION_PROJECT) {
		if (!projectBase) throw new Error("resolveContactsDir: location \"project\" needs a projectBase");
		return join(projectBase, "contacts");
	}
	// An explicit path is taken as given: a caller that names one has already decided.
	return location;
}

/** PURE-ish. The three states of a platform's store, so absent and corrupt stay distinguishable. */
export function readContacts(platform, contactsDir) {
	const file = join(contactsDir, `${platform}.json`);
	if (!existsSync(file)) return { state: "absent", contacts: [], file };
	try {
		const data = JSON.parse(readFileSync(file, "utf8"));
		const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
		return { state: "present", contacts, file };
	} catch (error) {
		return {
			state: "unreadable",
			contacts: [],
			file,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * The contacts a platform has, or an empty list when the store is absent OR unreadable.
 *
 * KEPT FOR READERS THAT ONLY WANT THE LIST. Anything that WRITES must use {@link readContacts}
 * and refuse on `unreadable` — see the note on {@link saveContacts}.
 */
export function loadContacts(platform, contactsDir) {
	return readContacts(platform, contactsDir).contacts;
}

/**
 * Merge new contacts into the store, keeping what is already there.
 *
 * REFUSES ON AN UNREADABLE STORE, and that is the bug this promotion fixes. The original merged
 * onto whatever the loader returned, and the loader returned `[]` for a corrupt file — so a
 * single bad byte turned "everything this bot can reach" into "the handful discovered just now",
 * written over the top, with nothing raised. Losing a destination silently is worse than failing
 * to add one loudly.
 *
 * @param {string} platform
 * @param {Contact[]} newContacts
 * @param {string} contactsDir
 * @param {object} [options]
 * @param {string} [options.locale]  Collation for the stable order. The caller's, not this one's.
 * @param {() => string} [options.now]
 * @returns {Contact[]} the merged list
 */
export function saveContacts(platform, newContacts, contactsDir, options = {}) {
	const { locale, now = () => new Date().toISOString() } = options;
	const existing = readContacts(platform, contactsDir);
	if (existing.state === "unreadable") {
		throw new Error(
			`refusing to overwrite an unreadable contacts store at ${existing.file}: ${existing.reason}. ` +
				"Merging onto it would drop every destination it holds.",
		);
	}

	const byId = new Map(existing.contacts.map((contact) => [String(contact.id), contact]));
	for (const contact of newContacts) {
		const id = String(contact.id);
		byId.set(id, { ...byId.get(id), ...contact });
	}
	const merged = [...byId.values()].sort((left, right) =>
		String(left.name ?? left.id).localeCompare(String(right.name ?? right.id), locale),
	);

	mkdirSync(contactsDir, { recursive: true });
	const temporary = `${existing.file}.writing`;
	writeFileSync(
		temporary,
		`${JSON.stringify({ platform, updatedAt: now(), contacts: merged }, null, 2)}\n`,
		"utf8",
	);
	renameSync(temporary, existing.file);
	return merged;
}
