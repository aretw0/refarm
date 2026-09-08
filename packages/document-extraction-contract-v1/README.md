# @refarm.dev/document-extraction-contract-v1

Contrato `documento-extraido/v1`: o envelope comum emitido por todo extrator
de documento financeiro doméstico (contracheque, extrato, fatura, NFC-e...).
A autoridade é o JSON Schema publicado em
`schema/documento-extraido-v1.json`; este pacote também publica a suíte de
conformidade em `fixtures/conformance.json` e um validador TypeScript fino
que a satisfaz.

O schema veio como está do coop-vault, onde já valida quatro extratores
contra documentos reais — não foi redesenhado aqui.

## Por que schema e fixtures são dado, não código

O artefato contratual é o JSON, não o TypeScript. Isso permite que um
validador em outra linguagem (por exemplo, Python) consuma exatamente o
mesmo `schema/documento-extraido-v1.json` e as mesmas
`fixtures/conformance.json`, e que a equivalência entre os dois validadores
vire teste executável em vez de promessa.

## Subconjunto de JSON Schema coberto

`validar()` cobre exatamente este subconjunto, nem mais nem menos — o mesmo
que o validador Python de referência (`contrato.py`, no coop-vault) declara
no próprio docstring:

- `type`, inclusive como lista de tipos;
- `required`;
- `properties`;
- `additionalProperties`, como `false` ou como um esquema único;
- `enum`;
- `items`, para arrays.

Qualquer construção de JSON Schema fora dessa lista é ignorada em silêncio.
Se o schema passar a usar algo fora dela, o validador — nas duas
linguagens — precisa crescer junto.

**Dinheiro é sempre string decimal.** O campo `lancamentos[].valor` é
`string`, nunca `number`, porque ponto flutuante não é seguro para dinheiro.

## Uso

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

const problemas = validar(envelope); // [] quando válido

// prova que este validador satisfaz o contrato inteiro
const resultado = rodarConformidade(validar);
resultado.divergencias; // [] quando conforme
```

`carregarSchema()` e `carregarFixtures()` leem os dois arquivos JSON
publicados no próprio pacote (`schema/documento-extraido-v1.json` e
`fixtures/conformance.json`), disponíveis também via subpath export para
quem quer consumi-los diretamente, de qualquer linguagem:

```ts
import schema from "@refarm.dev/document-extraction-contract-v1/schema/documento-extraido-v1.json" with { type: "json" };
import fixtures from "@refarm.dev/document-extraction-contract-v1/fixtures/conformance.json" with { type: "json" };
```

## Caminho, não mensagem

Cada problema devolvido por `validar()` é uma string `"caminho: mensagem"`.
A suíte de conformidade compara apenas o **caminho** (`envelope.campo`,
`envelope.lancamentos[0].campo`) contra `caminhos_com_problema` de cada
fixture — a mensagem é redação livre por implementação. É o caminho que é o
contrato; a mensagem, não.

## Fronteira

Este pacote possui:

- o JSON Schema do envelope `documento-extraido/v1`, como dado publicado;
- a suíte de fixtures de conformidade, como dado publicado;
- um validador TypeScript fino do subconjunto de JSON Schema acima;
- tipos TypeScript derivados do schema.

Este pacote não possui:

- extratores de documento específicos (PDF, OCR, layout de banco/cartão);
- qualquer lógica de negócio sobre o conteúdo dos lançamentos;
- persistência, sincronização, ou apresentação do envelope.
