---
"@refarm.dev/silo": minor
---

Add a namespaced credential-collection front door and namespaced secret store, keeping model, runtime, channel, and publishing secrets separate. Publish typed `./collect` and `./key-manager` subpaths so consumers can import the Silo SDK helpers directly.

Make Silo's provider-token output product-neutral: `resolve()` and `provision("object")` now return provider-native keys such as `GITHUB_TOKEN` and `CLOUDFLARE_API_TOKEN`, while `SILO_HOME` is the preferred storage-home override. `REFARM_HOME` remains a storage fallback for existing Refarm operators.
