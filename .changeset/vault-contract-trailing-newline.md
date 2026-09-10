---
"@refarm.dev/vault-contract-v1": patch
---

`recordToVaultNote` ends the note with exactly one newline instead of appending one to whatever the section already had. A section ending in `\n` produced a note ending in `\n\n`, and re-projecting that note carried the extra line back into the record — so every materialize/re-project cycle grew the body by one line. Drift rather than loss: a fidelity check that trims the body never sees it, and only a round-trip drill exposes it.
