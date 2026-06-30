# @refarm.dev/silo

Silo is a context and secret provisioner. It manages provider tokens, identity
metadata, and namespaced secrets without requiring consumer CLIs to adopt
host-specific environment variable names.

## Features

- **Context Provisioning**: Resolve and inject provider secrets into specific targets (e.g. GitHub Actions).
- **Master Key Management**: Bootstrap and protect local identity key material.
- **Persistence**: Owner-only local storage of provider tokens, namespaced secrets, and non-sensitive identity metadata.

`SiloCore.resolve()` and `SiloCore.provision("object")` return provider-native
keys such as `GITHUB_TOKEN` and `CLOUDFLARE_API_TOKEN`. Use `SILO_HOME` to choose
the default local storage directory, or pass `storagePath` explicitly. Existing
hosts can still rely on `REFARM_HOME` as the storage fallback when `SILO_HOME`
is unset.

Namespaced secrets are the stable consumer surface for channel/publishing
credentials and similar project-local secrets:

```js
const silo = new SiloCore({ storagePath: "/path/to/identity.json" });

await silo.saveSecret("publishing", "TELEGRAM_BOT_TOKEN", token);
await silo.saveSecret("publishing", "TELEGRAM_CHAT_ID", chatId);

const publishingEnv = await silo.listSecrets("publishing");
await silo.removeSecret("publishing", "TELEGRAM_BOT_TOKEN");
```

`listSecrets(namespace)` is intentionally namespace-scoped; callers compose
service-level status or deletion by choosing the ids they own. Storage writes
the containing directory with `0700` and the JSON file with `0600` on POSIX
filesystems, with a no-op guard on platforms that do not support those modes.

The base `SiloCore` storage surface does not import the identity/Heartwood
closure. `bootstrapIdentity()` loads `./key-manager` dynamically, and
`@refarm.dev/heartwood` is optional for storage-only consumers. Consumers that
use the `./key-manager` identity subpath must ensure Heartwood is available.

See [ROADMAP.md](./ROADMAP.md) for the path to OPAQUE-based encryption and hardware isolation.
