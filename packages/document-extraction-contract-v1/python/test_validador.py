#!/usr/bin/env python3
"""Conformance tests for the documento-extraido/v1 Python validator.

Runs `validador.validar` against every case in `fixtures/conformance.json`
and requires exact agreement on the PATH of each returned problem — never
the message, which is free wording per implementation. Mirrors what
`src/conformance.test.ts` does on the TypeScript side of this package.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import validador  # noqa: E402  (path must be extended first)


def _extrair_caminho(problema: str) -> str:
    """Extracts the path from a problem in the `path: message` format.
    The message after `:` is free per implementation; only the path matters.
    """
    indice = problema.find(":")
    return problema if indice == -1 else problema[:indice]


def _conjunto_ordenado(caminhos: list[str]) -> list[str]:
    return sorted(set(caminhos))


class SchemaTest(unittest.TestCase):
    def test_schema_declara_a_versao_e_as_classes_conhecidas(self) -> None:
        schema = validador.carregar_schema()
        self.assertEqual(schema["title"], "documento-extraido/v1")
        self.assertIn("classe", schema["required"])


class FixturesTest(unittest.TestCase):
    def test_fixtures_cobrem_caso_valido_e_casos_invalidos(self) -> None:
        fixtures = validador.carregar_fixtures()
        validos = [c for c in fixtures["casos"] if not c["caminhos_com_problema"]]
        invalidos = [c for c in fixtures["casos"] if c["caminhos_com_problema"]]
        self.assertGreater(len(validos), 0)
        self.assertGreaterEqual(len(invalidos), 8)


class ConformidadeTest(unittest.TestCase):
    def test_validador_python_satisfaz_a_conformidade(self) -> None:
        fixtures = validador.carregar_fixtures()
        divergencias = []

        for caso in fixtures["casos"]:
            problemas = validador.validar(caso["envelope"])
            obtido = _conjunto_ordenado([_extrair_caminho(p) for p in problemas])
            esperado = _conjunto_ordenado(caso["caminhos_com_problema"])
            if obtido != esperado:
                divergencias.append(
                    {"nome": caso["nome"], "esperado": esperado, "obtido": obtido}
                )

        self.assertEqual(divergencias, [], f"conformance divergences: {divergencias}")


if __name__ == "__main__":
    unittest.main()
