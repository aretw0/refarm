---
"@refarm.dev/silo": minor
---

Add a namespaced credential-collection front door and namespaced secret store, keeping model, runtime, channel, and publishing secrets separate. Publish typed `./collect` and `./key-manager` subpaths so consumers can import the Silo SDK helpers directly.

Make Silo's provider-token output product-neutral: `resolve()` and `provision("object")` now return provider-native keys such as `GITHUB_TOKEN` and `CLOUDFLARE_API_TOKEN`, while `SILO_HOME` is the preferred storage-home override. `REFARM_HOME` remains a storage fallback for existing Refarm operators.

Complete the first public Silo storage surface with namespace bulk helpers, owner-only storage modes,
and a versioned secret envelope that reports its current `local-plaintext-v1` protection status while
leaving OPAQUE and hardware-backed encryption as internal upgrades behind the same consumer API. Keep
the base storage surface free of the Heartwood identity install closure; Heartwood remains optional
until identity or future encrypted envelope paths are exercised.
