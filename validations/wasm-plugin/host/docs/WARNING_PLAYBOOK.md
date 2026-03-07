# Warning Playbook: Node Modules Externalized (Vite)

## Warning

`Module "node:fs/promises" has been externalized for browser compatibility...`

## O que significa

Vite detectou um import de modulo Node em codigo cliente (browser). Ele nao polyfilla modulos Node automaticamente.

Referencia oficial:
- https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility

## Decisao por cenario

1. O modulo Node e necessario no browser.
- Acao: mover para server/runtime Node ou adotar polyfill manual consciente.
- Risco: bundle maior, variacoes de comportamento, custo de manutencao.

2. O modulo Node esta em caminho condicional Node-only e nao deve executar no browser.
- Acao: manter guardas de runtime e documentar como warning esperado.
- Acao recomendada no host Refarm: alias para shim browser + erro explicito se o caminho for executado.

3. O import vem de dependencia third-party supostamente browser-friendly.
- Acao: abrir issue no pacote e/ou aplicar patch temporario.
- Acao de contingencia: trocar dependencia.

4. O warning aparece e ha erro real em runtime browser.
- Acao: tratar como bug. Remover dependencia Node do caminho cliente imediatamente.

## Estado atual no Refarm host

- Arquivo gerado por jco contem import dinamico `node:fs/promises` em ramo Node-only.
- O host aplica alias para shim em browser para evitar execucao silenciosa.
- O host permite suprimir somente esse warning, via env var:
  - `VITE_SUPPRESS_NODE_EXTERNALIZED_WARNING=1`

Uso sugerido:

```bash
VITE_SUPPRESS_NODE_EXTERNALIZED_WARNING=1 npm run build
```

Padrao recomendado:
- Em desenvolvimento: manter warning visivel.
- Em CI controlado: suprimir apenas esse warning quando o guard rail estiver ativo e coberto por testes E2E.
