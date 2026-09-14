# @refarm.dev/document-extraction-contract-v1

Contract `documento-extraido/v1`: the common envelope emitted by every
domestic financial document extractor (payslip, bank statement, invoice,
NFC-e...). The authority is the JSON Schema published at
`schema/documento-extraido-v1.json`; this package also publishes the
conformance suite at `fixtures/conformance.json`, a thin TypeScript
validator at `src/validate.ts`, and a thin Python validator at
`python/validador.py` — both satisfy the same conformance suite, and that
equivalence is an executable test on each side, not a promise.

The schema came as-is from coop-vault, where it already validates four
extractors against real documents — it was not redesigned here. The Python
validator is a direct port of coop-vault's `scripts/documents/contrato.py`,
which stays the origin and the proof of correctness in production; this
package's copy is what other consumers (such as vault-seed) depend on
instead of copying it themselves.

## Why schema and fixtures are data, not code

The contractual artifact is the JSON, not the TypeScript or the Python.
That lets a validator in another language consume exactly the same
`schema/documento-extraido-v1.json` and the same
`fixtures/conformance.json`, and turns the equivalence between validators
into an executable test instead of a promise.

## JSON Schema subset covered

Both `validar()` implementations — TypeScript at `src/validate.ts` and
Python at `python/validador.py` — cover exactly this subset, no more and
no less:

- `type`, including as a list of types;
- `required`;
- `properties`;
- `additionalProperties`, as `false` or as a single schema;
- `enum`;
- `items`, for arrays.

Any JSON Schema construct outside this list is silently ignored. If the
schema starts using something outside it, the validator — in both
languages — needs to grow along with it.

**Money is always a decimal string.** The `lancamentos[].valor` field is
`string`, never `number`, because floating point is not safe for money.

## Usage

```ts
import {
	carregarFixtures,
	carregarSchema,
	rodarConformidade,
	validar,
	type DocumentoExtraido,
} from "@refarm.dev/document-extraction-contract-v1";

const envelope: DocumentoExtraido = {
	schemaVersion: 1,
	classe: "extrato-sicoob",
	fonte: {
		sha256: "…",
		bytes: 1234,
		paginas: 2,
		extraido_em: "2026-09-06T10:00:00-03:00",
	},
	lancamentos: [],
	avisos: [],
};

const problemas = validar(envelope); // [] when valid

// proves this validator satisfies the whole contract
const resultado = rodarConformidade(validar);
resultado.divergencias; // [] when conformant
```

`carregarSchema()` and `carregarFixtures()` read the two JSON files
published in the package itself (`schema/documento-extraido-v1.json` and
`fixtures/conformance.json`), also available via subpath export for
anyone who wants to consume them directly, from any language:

```ts
import schema from "@refarm.dev/document-extraction-contract-v1/schema/documento-extraido-v1.json" with { type: "json" };
import fixtures from "@refarm.dev/document-extraction-contract-v1/fixtures/conformance.json" with { type: "json" };
```

Python consumers get the same three things from `python/validador.py`,
depending on the standard library only — no `jsonschema`, no third-party
package:

```python
from validador import carregar_fixtures, carregar_schema, validar

envelope = {
    "schemaVersion": 1,
    "classe": "extrato-sicoob",
    "fonte": {
        "sha256": "…",
        "bytes": 1234,
        "paginas": 2,
        "extraido_em": "2026-09-06T10:00:00-03:00",
    },
    "lancamentos": [],
    "avisos": [],
}

problemas = validar(envelope)  # [] when valid
```

`carregar_schema()` and `carregar_fixtures()` read the same two JSON files
as their TypeScript counterparts, resolved relative to the package itself
(`schema/documento-extraido-v1.json` and `fixtures/conformance.json`).
`python/test_validador.py` runs `validar()` against every case in
`fixtures/conformance.json` and requires exact agreement on the path of
each problem — the same fixtures the TypeScript conformance suite
(`src/conformance.test.ts`) runs, so both validators are proved against one
shared set of cases.

## Path, not message

Each problem returned by `validar()` is a `"path: message"` string. The
conformance suite compares only the **path** (`envelope.campo`,
`envelope.lancamentos[0].campo`) against each fixture's
`caminhos_com_problema` — the message is free wording per implementation.
The path is the contract; the message is not.

## Boundary

This package owns:

- the JSON Schema for the `documento-extraido/v1` envelope, as published
  data;
- the conformance fixture suite, as published data;
- a thin TypeScript validator for the JSON Schema subset above;
- a thin Python validator for the same subset, standard-library only;
- TypeScript types derived from the schema.

This package does not own:

- specific document extractors (PDF, OCR, bank/card layout);
- any business logic over the content of the lancamentos;
- persistence, sync, or presentation of the envelope.
