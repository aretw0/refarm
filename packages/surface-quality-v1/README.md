# @refarm.dev/surface-quality-v1

Cross-modal quality profiles for Refarm-compatible surfaces. The package does not
render a UI and does not pretend that a DOM audit can certify a terminal or chat.
Instead, each modality supplies evidence produced by its own tests or checker and this
block aggregates it into the shared `quality:v1` report envelope.

Common requirements cover locale fallback, a proven primary journey, visible feedback,
non-colour-only meaning, and review before consequential actions. Web, terminal, and
chat then add requirements native to their interaction model.

```ts
import { checkSurfaceQuality } from "@refarm.dev/surface-quality-v1";

const report = await checkSurfaceQuality("chat", [
  { id: "locale-fallback", status: "pass", proof: "catalog parity test" },
  // ...evidence from delivery adapter tests
]);
```

Evidence is deliberately explicit. A missing or failed proof becomes a finding;
`not-applicable` is accepted only for requirements whose profile declares it, and must
carry a concrete reason.
