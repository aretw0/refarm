# Diferenças nos Testes E2E de WASM: `wasm-plugin-host` vs. `sqlite-benchmark-browser`

Este documento detalha as distinções fundamentais entre as abordagens de teste End-to-End (E2E) para módulos WebAssembly (WASM) nos projetos `wasm-plugin-host` e `sqlite-benchmark-browser` dentro do monorepo Refarm. Compreender essas diferenças é crucial para manter e estender corretamente cada validação.

## 1. Testes E2E do `sqlite-benchmark-browser`

### Propósito
Os testes E2E do `sqlite-benchmark-browser` são projetados para **avaliar e comparar o desempenho** de diferentes implementações do SQLite compiladas para WebAssembly, especificamente `sql.js` e `@sqlite.org/sqlite-wasm` (utilizando o Origin Private File System - OPFS), diretamente no ambiente do navegador. O objetivo é medir métricas como tempo de carregamento, inserção e consulta de dados.

### Mecanismo de Carregamento WASM
Neste projeto, o carregamento dos módulos WASM é realizado de forma mais direta:
*   **`sql.js`**: Utiliza a função `initSqlJs({ locateFile: (file) => `/${file}` })` para carregar o arquivo `sql-wasm.wasm`. A propriedade `locateFile` instrui o `sql.js` a buscar o arquivo WASM na raiz do servidor.
*   **`@sqlite.org/sqlite-wasm`**: Carregado via `sqlite3InitModule()`, que por padrão busca os arquivos WASM (`sqlite3.wasm`, `sqlite3-opfs-async-proxy.wasm`, etc.) no mesmo diretório do script que o inicializa, ou em um caminho configurado.

**Ponto Crítico**: Ambos os métodos dependem que o servidor web que hospeda a aplicação sirva os arquivos `.wasm` com o **MIME type correto (`application/wasm`)**. A ausência ou configuração incorreta deste MIME type resulta em erros de compilação e instanciamento do WASM, como observado nos logs fornecidos (`TypeError: Unexpected response MIME type. Expected 'application/wasm'`).

### Abordagem de Teste
Os testes E2E são implementados com Playwright (`sqlite-bench.spec.ts`). Eles:
1.  Navegam para a página principal da aplicação de benchmark (`await page.goto('/')`).
2.  Interagem com a interface para iniciar o processo de benchmark (e.g., `await page.click('#run-all')`).
3.  Aguardam a conclusão do benchmark, indicada por um seletor específico na UI (`await page.waitForSelector('.bench-done')`).
4.  Extraem os resultados e logs exibidos na página (`await page.innerText('#logs')`).
5.  Validam a presença de resultados para ambas as implementações do SQLite WASM (`expect(logs).toContain('sql.js')` e `expect(logs).toContain('sqlite-wasm (OPFS)')`).

## 2. Testes E2E do `wasm-plugin-host`

### Propósito
O `wasm-plugin-host` serve como uma **validação da arquitetura de plugins baseada no WebAssembly Component Model**. Seu objetivo principal é demonstrar e testar o ciclo de vida de um plugin WASM (carregamento, configuração, ingestão de dados e desativação) e a integração com o host, utilizando as ferramentas do Component Model (como `jco`).

### Mecanismo de Carregamento WASM
A abordagem de carregamento WASM aqui é significativamente diferente e mais abstrata:
*   **WebAssembly Component Model e `jco`**: Em vez de carregar arquivos `.wasm` diretamente, o `wasm-plugin-host` utiliza componentes WASM que foram transpilados para módulos JavaScript usando a ferramenta `jco`. Isso significa que os arquivos `.wasm` subjacentes (`hello-world.core.wasm`, `hello-world.core2.wasm`) são importados e gerenciados indiretamente através de um módulo JavaScript gerado (`./generated/hello-world.js`).
*   **Abstração do MIME Type**: Como o carregamento é orquestrado pelo JavaScript gerado pelo `jco`, a preocupação direta com o MIME type do servidor para os arquivos `.wasm` é mitigada. O ambiente de execução (Vite, neste caso) já lida com a entrega correta desses arquivos como parte do processo de build e servimento dos módulos JS.

### Abordagem de Teste
Os testes E2E também são feitos com Playwright (`plugin-lifecycle.spec.ts`). Eles se concentram na interação com a UI para validar o fluxo do plugin:
1.  Navegam para a página do host.
2.  Simulam cliques em botões para carregar o plugin (`load-btn`), executar o setup (`setup-btn`), iniciar a ingestão (`ingest-btn`) e obter metadados (`metadata-btn`).
3.  Verificam o status da UI e os logs para confirmar que cada etapa do ciclo de vida do plugin foi executada com sucesso.
4.  Validam as informações de metadados do plugin.

## 3. Principais Diferenças e Implicações

A tabela a seguir resume as principais diferenças:

| Característica              | `sqlite-benchmark-browser`                               | `wasm-plugin-host`                                         |
| :-------------------------- | :------------------------------------------------------- | :--------------------------------------------------------- |
| **Propósito Principal**     | Benchmark de desempenho de implementações SQLite WASM.   | Validação da arquitetura de plugins com WebAssembly Component Model. |
| **Carregamento WASM**       | Direto, via `locateFile` ou `sqlite3InitModule`.         | Indireto, via módulos JavaScript transpilados por `jco`.   |
| **Dependência de MIME Type**| **Alta**. Requer `application/wasm` explicitamente.      | **Baixa**. Abstraído pela transpilação `jco`.              |
| **Foco do Teste**           | Medição de performance e validação de resultados numéricos. | Ciclo de vida do plugin e integração com o host.           |
| **Complexidade de Config.** | Configuração do servidor para MIME types WASM.           | Configuração de ferramentas do Component Model (`jco`).    |

### Implicações
*   **`sqlite-benchmark-browser`**: A correção do erro de MIME type foi fundamental e envolveu a configuração do servidor (Vite) para servir corretamente os arquivos `.wasm`. Isso destaca a necessidade de atenção à infraestrutura de deployment ao lidar com carregamento direto de WASM.
*   **`wasm-plugin-host`**: A complexidade de lidar com o carregamento de WASM é movida para a etapa de build (transpilação com `jco`), simplificando a lógica de runtime no navegador e tornando-o menos suscetível a problemas de configuração de servidor de MIME type para os arquivos `.wasm` em si.

## Conclusão

Enquanto ambos os projetos utilizam WebAssembly e testes E2E, eles o fazem com objetivos e mecanismos de integração WASM distintos. O `sqlite-benchmark-browser` foca na performance de implementações SQLite, exigindo controle sobre o carregamento direto de arquivos `.wasm` e, consequentemente, a correta configuração de MIME types. Já o `wasm-plugin-host` explora o WebAssembly Component Model para uma arquitetura de plugins mais robusta e abstrata, onde o `jco` gerencia a complexidade do carregamento WASM. Ambas as abordagens são válidas e servem a propósitos específicos dentro do ecossistema Refarm.
