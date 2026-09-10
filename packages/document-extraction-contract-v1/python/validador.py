#!/usr/bin/env python3
"""Validator for the documento-extraido/v1 envelope.

The authority is the JSON Schema published by this package, resolved at
`SCHEMA_PATH`. This module is deliberately thin: all the semantics live in
the schema, so a validator in another language can be proved equivalent
against the same fixtures.

JSON Schema subset covered, and only it: `type` (including as a list of
types), `required`, `properties`, `additionalProperties` as `false` or as a
single schema, `enum`, and `items` for arrays. Any construct outside this
list is silently ignored — if the schema starts using it, this validator
needs to grow along with it.

This is a direct port of `scripts/documents/contrato.py` in coop-vault. The
validation logic and the format of problem paths are unchanged on purpose —
`envelope.campo` and `envelope.lancamentos[0].campo` are the contract, and
consumers already depend on them.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

# `validador.py` lives in `python/`, alongside `schema/` and `fixtures/`
# inside this package. Resolve relative to this file — never the cwd — so
# it works regardless of where the caller invokes it from.
_PACOTE = Path(__file__).resolve().parent.parent

SCHEMA_PATH = _PACOTE / "schema" / "documento-extraido-v1.json"
FIXTURES_PATH = _PACOTE / "fixtures" / "conformance.json"

TIPOS = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "null": type(None),
}


def carregar_schema() -> dict[str, Any]:
    """Loads `schema/documento-extraido-v1.json` from the package itself."""
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def carregar_fixtures() -> dict[str, Any]:
    """Loads the conformance fixtures (`fixtures/conformance.json`) published
    by this package."""
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def _tipo_confere(valor: Any, esperado: Any) -> bool:
    nomes = esperado if isinstance(esperado, list) else [esperado]
    for nome in nomes:
        alvo = TIPOS.get(nome)
        if alvo is None:
            continue
        # bool is a subclass of int in Python; a boolean does not satisfy "integer".
        if nome in {"integer", "number"} and isinstance(valor, bool):
            continue
        if isinstance(valor, alvo):
            return True
    return False


def _validar_no(valor: Any, esquema: dict[str, Any], caminho: str) -> list[str]:
    problemas: list[str] = []

    if "type" in esquema and not _tipo_confere(valor, esquema["type"]):
        problemas.append(f"{caminho}: esperado {esquema['type']}, veio {type(valor).__name__}")
        return problemas

    if "enum" in esquema and valor not in esquema["enum"]:
        problemas.append(f"{caminho}: valor fora do enum {esquema['enum']}")

    if isinstance(valor, dict):
        for obrigatorio in esquema.get("required", []):
            if obrigatorio not in valor:
                problemas.append(f"{caminho}.{obrigatorio}: campo obrigatório ausente")
        propriedades = esquema.get("properties", {})
        extras = esquema.get("additionalProperties", True)
        for chave, sub in valor.items():
            if chave in propriedades:
                problemas += _validar_no(sub, propriedades[chave], f"{caminho}.{chave}")
            elif extras is False:
                problemas.append(f"{caminho}.{chave}: campo desconhecido")
            elif isinstance(extras, dict):
                problemas += _validar_no(sub, extras, f"{caminho}.{chave}")

    if isinstance(valor, list) and isinstance(esquema.get("items"), dict):
        for indice, item in enumerate(valor):
            problemas += _validar_no(item, esquema["items"], f"{caminho}[{indice}]")

    return problemas


def validar(envelope: dict[str, Any]) -> list[str]:
    """Returns the list of problems. Empty means valid."""
    return _validar_no(envelope, carregar_schema(), "envelope")


def exigir_valido(envelope: dict[str, Any]) -> None:
    problemas = validar(envelope)
    if problemas:
        raise ValueError("envelope inválido:\n  " + "\n  ".join(problemas))


def envelope(classe: str, fonte: dict[str, Any], **campos: Any) -> dict[str, Any]:
    """Builds an envelope with the required fields already in place."""
    base: dict[str, Any] = {
        "schemaVersion": 1,
        "classe": classe,
        "fonte": dict(fonte),
        "lancamentos": [],
        "avisos": [],
    }
    base.update(campos)
    return base


def agora_local() -> str:
    return datetime.now().astimezone().replace(microsecond=0).isoformat()
