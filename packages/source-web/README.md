# @refarm.dev/source-web

Authenticated web snapshot adapter for the `source:v1` librarian boundary.

`source-web` does not add a new source contract. It materializes authenticated
web capture evidence as a stable local snapshot and therefore reports
`location.kind = "local"` to `source:v1`. The web-specific details live in this
package's provenance:

- session/auth lifecycle evidence;
- pacing policy;
- cache identity and content hash;
- offline replay flag;
- redaction report.

The package intentionally does not own target discovery, selectors, aliases, or
real login flows. Consumers inject those concerns downstream and hand the
adapter sanitized snapshots or capture fixtures.

## Fixture Proof

```bash
pnpm -C packages/source-web run test
```

The reference fixture proves that a requirements-like authenticated web source
can be replayed without network access while still passing the `source:v1`
conformance suite.
