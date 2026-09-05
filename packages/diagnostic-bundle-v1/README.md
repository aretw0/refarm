# `@refarm.dev/diagnostic-bundle-v1`

Portable contract for diagnostic evidence that an operator can inspect before sharing.

The package performs no I/O and knows no Refarm app commands. Hosts and plugins contribute
JSON-safe sections; surfaces render the same sanitized bundle. Secret-bearing keys, known secret
values, bearer credentials, credentialed URLs and private keys are removed at construction. A
consumer can run `verifyDiagnosticBundle` before persisting or transporting it.

Redaction is a safety boundary, not permission to collect arbitrary workspace output. Producers
should contribute narrow structured facts and omit prompts, responses and command stdout by
default.
