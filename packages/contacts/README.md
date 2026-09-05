# @refarm.dev/contacts

Channel topology: which chats, groups and handles a platform can reach, stored per platform and
merged by id.

Promoted from `@aretw0/dgk-channels`, whose ROADMAP named this package as its destination.

```js
import { resolveContactsDir, readContacts, saveContacts } from "@refarm.dev/contacts";

const dir = resolveContactsDir({ location: "local", localBase: "/home/me/.refarm" });
saveContacts("telegram", discovered, dir, { locale: "pt" });
```

**A credential says who a channel speaks as; this says where it lands.** One bot addresses many
chats — the platform's own model — so a workspace that wants its own channel declares a
destination rather than minting a credential.

- **No directory is baked in.** The caller names the base for `local` and for `project`.
- **A corrupt store is never silently overwritten.** `readContacts` reports present / absent /
  unreadable, and `saveContacts` refuses to merge onto an unreadable one. The original merged onto
  whatever the loader returned and the loader returned `[]` for a bad file, so one corrupt byte
  replaced every known destination with whatever was discovered that minute.
- **The sort locale is the caller's.**

Discovery is not here. Asking a platform which chats exist means speaking its protocol, and that
belongs beside the transport that already does — in this repository, the delivery adapter.
