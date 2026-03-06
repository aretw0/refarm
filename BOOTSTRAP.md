# BOOTSTRAP

## Fase 1: Alpha - O Solo Soberano & Minimalismo Web (Meses 1 a 3)

*Objetivo: Estabilizar as fundações de armazenamento e interface, provando a arquitetura básica antes de introduzir descentralização ou IA pesada.*

* **1. A Interface Unificada (PWA & Web Components)**
  * Evoluir o atual `apps/studio` (Astro) para um Progressive Web App (PWA).
  * O *Kernel* fornecerá uma UI Headless baseada em Web Components, para que os plugins renderizem dados sem pesar o navegador.
* **2. O Solo (Sovereign Graph) e Segurança WASI**
  * Implementar o *Capability-Based Security* via `refarm-sdk.wit`, garantindo que plugins (WASM) tenham permissões granulares de acesso ao `storage-sqlite`.
  * Garantir a estrita validação dos dados contra o `sovereign-graph.jsonld`.
* **3. Rede Agnóstica (Vines de HTTP)**
  * Criar o adaptador de rede e provar o conceito de sincronização construindo um plugin genérico de export/import usando HTTP/REST clássico (arquitetura tradicional).
* **4. IA Leve: Preparação Semântica (Transformers.js)**
  * *Pragmatismo IA:* Ainda não vamos usar WebLLM. Introduziremos *Transformers.js* via componentes WASM locais para tarefas leves (ex: gerar embeddings de texto para busca semântica ou auto-taguear anotações no *Solo*). Isso roda na CPU de forma instantânea sem grande consumo de memória.

## Fase 2: Beta - Conectividade Híbrida & Cognição Local (Meses 4 a 6)

*Objetivo: Fazer o Refarm conversar com servidores de terceiros (sem depender deles) e introduzir o "Cérebro Local" para organizar os dados ingeridos.*

* **1. A Federação Matrix (O Teste de Fogo da Rede)**
  * Construir a *Matrix Sync Vine*: um plugin que se conecta ao Homeserver Matrix do seu colega, usando as "salas" do Matrix apenas como um túnel de transporte para os relógios vetoriais do seu pacote `sync-crdt`. Isso prova a resiliência *stateless* do Refarm.
* **2. Migrações e Resiliência de Dados**
  * Implementar o motor de *Event Sourcing* e *Upcasting* (Lentes) para permitir que o esquema JSON-LD evolua na máquina de *beta testers* sem corromper o banco local.
* **3. IA Estrutural: A Chegada do WebLLM (Cognição Local)**
  * *Pragmatismo IA:* Introduzir o **WebLLM** como um *Local Mill* (Moinho Local).
  * Usaremos a funcionalidade nativa do WebLLM de **Web Workers/Service Workers** para que a IA rode em WebGPU numa thread separada, não afetando a performance da interface do usuário.
  * Focaremos no recurso de **Structured JSON Generation** do WebLLM. Quando uma ponte de comunicação (ex: Matrix, Signal) injetar mensagens brutas no sistema, o WebLLM lerá esse texto e o converterá em nós `JSON-LD` perfeitos, estruturando dados caóticos diretamente no seu *Solo*.

## Fase 3: v1.0 - Sistema Operacional Descentralizado & Autônomo (Meses 7 a 9)

*Objetivo: Lançamento público da arquitetura peer-to-peer real, expansão do ecossistema e transformação do Refarm num agente autônomo.*

* **1. O Marketplace e Peer-to-Peer Nativo (Nostr & WebRTC)**
  * Habilitar o uso completo do `identity-nostr` para o Marketplace Descentralizado via NIP-89/94, permitindo que a comunidade troque plugins sem servidores centrais.
  * Lançar a ponte de WebRTC local para que dispositivos (ex: celular e PC) sincronizem o grafo instantaneamente quando na mesma rede Wi-Fi.
* **2. Delegação Externa Completa (Mills & Tractors)**
  * Finalizar as APIs para hospedar automações em hardwares remotos (Cloudflare, Raspberry Pi) controlados pelas UIs do Refarm no navegador.
* **3. IA Agêntica: Orquestração do Refarm**
  * *Pragmatismo IA:* Ativar o suporte preliminar a **Function-Calling** do WebLLM.
  * O WebLLM deixará de ser apenas um classificador de texto e se tornará um Agente. Com compatibilidade total com a API da OpenAI, o SLM local poderá entender a linguagem natural do usuário (ex: "Agende uma consulta para a clínica") e "chamar" as funções da interface `refarm-sdk.wit` internamente para executar a ação e salvar no banco de dados, tudo 100% offline.

### Fase 4: Expansão - Singularidade Plena (Pós v1.0)

*Objetivo: Adaptar-se a qualquer modelo de IA, a qualquer rede de transporte e suprir nichos específicos.*

* **1. Roteamento Dinâmico de Rede**
  * O *Kernel* se torna inteligente o suficiente para alternar o transporte do pacote CRDT dinamicamente (WebRTC no local, Matrix na falha local, IPFS/libp2p como fallback).
* **2. Adoção Multimodal Externa (MediaPipe)**
  * Adicionar *MediaPipe* ao ecossistema para criar *Foragers* (Coletores) de Visão Computacional. Exemplo: um navegador em um Raspberry Pi com uma webcam olhando para o estoque da sua prima; o MediaPipe identifica objetos localmente e o plugin gera um registro no grafo soberano.
* **3. Modelos Customizáveis (Custom Models)**
  * Permitir que usuários importem e compilem seus próprios SLMs finamente ajustados (Fine-tuned) para as regras de negócio de suas comunidades, usando a integração de *Custom Models* em formato MLC suportada pelo WebLLM.

**Resumo da Visão Final:**
Este roadmap consolida o Refarm como um colosso técnico disfarçado de simplicidade. Ao abstrair a rede (HTTP → Matrix → WebRTC) e abstrair a inteligência (Transformers.js → WebLLM/WebGPU), você não impõe nada ao usuário, enquanto entrega um *Sistema Operacional Pessoal* que é à prova de censura, soberano aos dados (via SQLite/OPFS e CRDT) e que roda com inteligência de nível de servidor usando apenas o navegador local.
