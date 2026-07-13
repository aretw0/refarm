"""Análise do Grafo de Requisitos — um notebook Marimo reativo.

Lê o dataset `grafo-de-requisitos` (publicado pelo verbo `requirements-lab`) e mostra os
requisitos-hub (mais conexões), os órfãos (sem relação) e a densidade da rede. Exportado para
HTML+WASM roda inteiro no navegador (Pyodide) — sem servidor, sem dados institucionais.

Segue o padrão do bloco Lab do refarm: o notebook lê SÓ via o id do dataset (nunca um caminho),
então é portável — o mesmo notebook serve qualquer corpus que publique `grafo-de-requisitos`.
"""

import marimo

app = marimo.App(width="medium")


@app.cell
def _():
    import json
    import urllib.request

    import marimo as mo

    return json, mo, urllib


@app.cell
def _(json, urllib):
    # O runtime do Lab resolve o dataset por id; aqui, a variante mínima lê o snapshot publicado.
    # (No empacotamento WASM, o dgk-lab-runtime troca isto por um fetch no navegador.)
    def load_dataset():
        try:
            with urllib.request.urlopen("datasets/grafo-de-requisitos.json") as f:
                return json.load(f)
        except Exception:
            # fallback local durante o desenvolvimento
            with open(".dgk/lab/grafo-de-requisitos.json", encoding="utf-8") as f:
                return json.load(f)

    data = load_dataset()
    return (data,)


@app.cell
def _(data, mo):
    mo.md(
        f"""
        # Análise do Grafo de Requisitos

        - **{data['nodeCount']}** requisitos
        - **{data['linkCount']}** relações
        - densidade: **{(data['linkCount'] / max(1, data['nodeCount'])):.2f}** relações/requisito
        """
    )
    return


@app.cell
def _(data):
    # Grau (conexões) por requisito → os hubs.
    degree = {n["id"]: n.get("degree", 0) for n in data["nodes"]}
    label = {n["id"]: n.get("label", n["id"]) for n in data["nodes"]}
    hubs = sorted(data["nodes"], key=lambda n: n.get("degree", 0), reverse=True)[:5]
    orphans = [n for n in data["nodes"] if n.get("degree", 0) == 0]
    return degree, hubs, label, orphans


@app.cell
def _(hubs, label, mo, orphans):
    hub_lines = "\n".join(f"- **{label[h['id']]}** — {h.get('degree', 0)} conexões" for h in hubs)
    orphan_lines = "\n".join(f"- {label[o['id']]}" for o in orphans) or "_nenhum_"
    mo.md(
        f"""
        ## Hubs (mais conectados)
        {hub_lines}

        ## Órfãos (sem relação)
        {orphan_lines}
        """
    )
    return


if __name__ == "__main__":
    app.run()
