# Requisitos do Operador do Refarm

Status: baseline vivo, iniciado em 2026-08-06 a partir da primeira entrevista explícita com o
operador e confrontado com o estado documentado do repositório.

Este documento responde primeiro à pergunta: **o que precisa ser verdade para o operador confiar no
Refarm como seu sistema operacional pessoal e profissional?** Ele organiza a necessidade pela vida do
operador, não pelos pacotes ou mecanismos que a implementam.

Não é um novo roadmap, uma promessa de entrega nem autorização para agir em outros repositórios,
contas ou serviços. Os roadmaps e specs continuam dizendo *como* e *quando* cultivar as capacidades.
Este documento diz *por quê*, *para quem* e *como reconhecer que o resultado chegou*.

## Fonte e regra de verdade

O baseline combina:

- a declaração do operador em 2026-08-06;
- a North Star e o método incremental de
  [`CONVERGENCE-LANE.md`](./CONVERGENCE-LANE.md);
- o daily driver e seus limites medidos em
  [`daily-driver-readiness.md`](./daily-driver-readiness.md);
- os contratos existentes em [`OPERATOR_PRIMITIVES.md`](./OPERATOR_PRIMITIVES.md);
- o loop operacional em
  [`REFARM_OPERATOR_DAILY_DRIVER.md`](./REFARM_OPERATOR_DAILY_DRIVER.md);
- o modelo de orçamento em
  [`The budget belongs to whoever spawns`](./superpowers/specs/2026-08-03-budget-laboratory-design.md);
- o cockpit de estado soberano em
  [`Which sovereign state is active`](./superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md).

Quando uma afirmação deste documento conflitar com uma medição atual, a medição vence e o baseline
deve ser corrigido. Quando conflitar com a necessidade declarada pelo operador, a divergência deve
ser apresentada ao operador; um agente não escolhe silenciosamente por ele.

## Vocabulário de maturidade

Cada requisito recebe um estado que não pode ser inferido apenas porque existe código relacionado:

| Estado | Significado |
| --- | --- |
| **Provado** | O caminho foi executado no ambiente real ou tem evidência equivalente e atual. |
| **Parcial** | Há capacidade útil entregue, mas o resultado do operador ainda exige intervenção, cobertura ou integração. |
| **Projetado** | Há decisão/spec suficiente para implementar, mas a operação ainda não foi provada. |
| **Ausente** | O contrato necessário ainda não existe ou o sistema admite que não o mede. |
| **Decisão do operador** | Alternativas materiais permanecem abertas; implementar uma delas sem confirmação mudaria a política do sistema. |
| **Desconhecido** | A evidência disponível não permite distinguir ausência, falha de leitura ou divergência. Nunca equivale a “está tudo bem”. |

## Missão

O Refarm deve ser o plano de controle soberano pelo qual o operador consegue:

1. saber o que demanda sua atenção e por quê;
2. despachar e acompanhar trabalho em seus projetos e serviços;
3. operar de qualquer dispositivo admitido, especialmente por Telegram, Termux e PWA;
4. conservar contexto e memória em workspaces, repositórios, vaults e no grafo;
5. conhecer custo, tempo, consumo, progresso, falhas e resultado do trabalho;
6. conceder consentimento nas fronteiras certas, sem transformar conveniência em autoridade implícita;
7. reduzir a administração direta de contas, plataformas e “pratos”, sem perder auditabilidade;
8. aprender com outros ecossistemas e consumidores sem absorver seus detalhes específicos no core.

O teste não é “quantas features o Refarm possui”. O teste é: **o operador consegue passar a maior
parte do dia gerindo vida e trabalho pelas superfícies escolhidas, enquanto o sistema explica o que
fez, quanto custou, o que falta e onde a intervenção humana é necessária?**

## Princípios não negociáveis

### Uma superfície, muitos sistemas

Refarm é o cockpit e a camada de compatibilidade operacional. Ele não precisa reimplementar Teams,
Outlook, Gmail, WhatsApp, navegadores, vaults ou CLIs de projeto. Precisa declarar, alcançar, governar
e observar capacidades desses sistemas por contratos e adaptadores.

### Contexto soberano e explícito

Um dispositivo é um nó; um projeto ou domínio é um workspace; uma conversa não substitui estado
durável. O sistema deve dizer qual home, nó, namespace, workspace, sessão, plugin e credencial estão
ativos. Divergência é dado operacional, não algo a resolver silenciosamente.

### Prestação de contas na origem

Todo trabalho observável deve poder carregar origem, finalidade, workspace, spawner, orçamento,
tempo, custo, estado terminal e evidência. “Desconhecido” e “não atribuído” são estados diferentes.
Um relatório não pode declarar totalidade quando a leitura foi truncada ou quando parte do trabalho
ocorreu fora do Refarm.

### Autoridade mínima e consentimento significativo

Ler, propor, despachar, escrever, publicar, autenticar, reiniciar, excluir e enviar mensagens são
autoridades diferentes. Acesso a um workspace ou canal não concede automaticamente todas elas.
Ações destrutivas, externas ou de amplo impacto exigem confirmação no ponto em que ainda podem ser
interrompidas.

### Assimilação sem centralização

`agents-lab`, `vault-seed`, `rcdc5`, vaults e outros projetos esticam a arquitetura e fornecem
evidência. O genérico pode subir para blocos Refarm quando uso repetido prova a fronteira; regras,
vocabulário e UX específicos permanecem em seus workspaces. `apps/refarm` é cockpit, não gravity
well.

### Cultivo incremental e sustentável

O caminho é feito de fatias pequenas, medidas e duráveis. Trabalho interno novo precisa responder a
falha real, ambiguidade de handoff, contrato público faltante ou pressão de segundo consumidor. Caso
contrário, a próxima evidência deve vir do uso do Refarm em trabalho não-Refarm.

### Segurança do trabalho paralelo

Agentes devem começar pela observação do handoff, runtime, resolução e worktree. Não devem reiniciar
o nó, promover artefatos, editar outro workspace, publicar, enviar mensagens ou reconciliar mudanças
paralelas sem autoridade explícita. Uma descoberta pode ser registrada sem ser automaticamente
“corrigida”.

## Resultados exigidos

### R1. Continuidade operacional

**Necessidade.** Retomar o trabalho sem reconstruir mentalmente sessões, tarefas, modelos, runtime,
falhas e validações anteriores.

**Critérios de aceitação.**

- `refarm resume --json` é sempre o ponto inicial e indica continuações executáveis;
- sessão, tarefa, logs e gates permanecem inspecionáveis depois do estado terminal;
- falha de runtime, credencial ou modelo aparece como unidade distinta;
- o operador consegue responder “onde eu estava?” sem recorrer à memória de um agente anterior.

**Estado: Parcial.** O loop de resume, sessões, tarefas e finish está entregue e sustenta uso
assistido. A readiness registrada é 83/100, abaixo do limiar de 85/100 definido para uso diário
primário, e ainda requer intervenção especializada em algumas falhas.

**Evidência.** [`REFARM_OPERATOR_DAILY_DRIVER.md`](./REFARM_OPERATOR_DAILY_DRIVER.md),
[`daily-driver-readiness.md`](./daily-driver-readiness.md).

### R2. Estado soberano inequívoco

**Necessidade.** Saber qual nó, home, namespace, credencial, runtime, workspace e artefato carregado
governam uma operação.

**Critérios de aceitação.**

- um comando relata o contexto resolvido e a origem de cada seleção;
- o artefato carregado é identificado por conteúdo, não apenas por caminho;
- divergências entre CLI, host, credenciais e disco são mostradas;
- laboratório e nó real não misturam estado nem ledger;
- o sistema diferencia nó ausente, leitura bloqueada e estado saudável.

**Estado: Parcial.** `refarm context` e diagnósticos de divergência existem. O launcher isolado e a
paridade do sandbox continuam projetados, e há divergências de home/visibilidade que ainda exigem
interpretação do operador.

**Evidência.**
[`Which sovereign state is active`](./superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md).

### R3. Ledger universal de trabalho

**Necessidade.** Prestar contas de tudo em que esforço é gasto, inclusive trabalho realizado por
ferramentas ou plataformas que o Refarm não despachou.

**Critérios de aceitação.** Cada unidade de trabalho pode registrar, quando conhecido:

- identificador e relação com tarefa, sessão, cenário e resultado;
- workspace/projeto e proveniência da atribuição;
- nó, superfície, spawner, agente/modelo e prestador;
- início, fim, duração, estado terminal e progresso planejado/concluído;
- tokens, custo monetário estimado ou medido, pricing mode e orçamento efetivo;
- artefatos, verificações ou referências que sustentam o resultado;
- lacunas de observação, truncamento e campos desconhecidos.

**Estado: Parcial.** `BudgetObservation` registra esforços despachados pelo Refarm e a atribuição de
workspace começou a chegar à origem. Não há ainda ingestão universal para trabalho externo; logo,
o ledger atual não pode afirmar “tudo”. Consultas agregadas por workspace/nó/superfície/modelo e
paginação completa também não estão concluídas.

**Evidência.**
[`The budget belongs to whoever spawns`](./superpowers/specs/2026-08-03-budget-laboratory-design.md),
[`SOVEREIGN_RECORD_ORDERING.md`](./SOVEREIGN_RECORD_ORDERING.md).

### R4. Orçamento sustentável e explicável

**Necessidade.** Saber com o que o operador está gastando recursos, quem declarou o limite, quem o
restringiu e se o trabalho entregue justificou o gasto.

**Critérios de aceitação.**

- limites de nó, workspace e dispatch são resolvidos separadamente;
- declarado, efetivo e `bound_by` permanecem no registro;
- custo por assinatura, API e modelo local não é misturado sob uma falsa equivalência;
- limites atingidos e trabalho parcial ficam visíveis;
- relatórios relacionam custo a resultado, não apenas a consumo;
- experimentos escrevem em ledger isolado.

**Estado: Parcial.** O contrato de orçamento e o registro por esforço existem; agregação operacional,
cobertura externa e isolamento completo do laboratório permanecem lacunas.

### R5. Workspaces como unidades de contexto e responsabilidade

**Necessidade.** Operar Refarm, `agents-lab`, `rcdc5`, vaults pessoais/profissionais e futuros
projetos sem confundir contexto, política, custo ou autoridade.

**Critérios de aceitação.**

- cada workspace tem identidade estável e declaração inspecionável;
- sessão e esforço mantêm a atribuição mesmo quando o comando parte de outro diretório/dispositivo;
- leitura, escrita e operação remota são capacidades distintas;
- workspaces ausentes ou somente leitura geram observações, não mutações oportunistas;
- detalhes corporativos ou de produto permanecem no workspace que os possui;
- uma visão mostra saúde, trabalho ativo, bloqueios, custo e próxima ação por workspace.

**Estado: Parcial.** Declaração, inspeção, execução nomeada e atribuição inicial existem. Correção de
sessões antigas, proveniência completa da atribuição, visão agregada e migração real do vault
profissional continuam abertas.

### R6. Despacho governado e supervisão

**Necessidade.** Despachar trabalho, deixá-lo progredir e intervir apenas quando necessário, sem
perder controle sobre escopo ou impacto.

**Critérios de aceitação.**

- uma demanda vira esforço rastreável com orçamento, deadline e critérios de conclusão;
- cancelamento, timeout, falha, parcial e entregue são estados explícitos;
- o agente pode pausar para consentimento e continuar sem perder o contexto;
- automações recorrentes usam o mesmo contrato de esforço das execuções manuais;
- nenhum handoff depende de texto implícito ou de memória privada do agente;
- qualidade do resultado pode ser verificada por evidência adequada ao cenário.

**Estado: Parcial.** Esforços, tarefas, handoffs, cancelamento e consentimento possuem blocos úteis.
Automação operada, localização de automações de nó, agendamento e avaliação rica de correção ainda
não formam um caminho completo.

### R7. Operação por dispositivos e superfícies leves

**Necessidade.** Gerir o dia prioritariamente por Telegram, Termux e PWA, usando o computador e
outros dispositivos como nós da mesma rede de trabalho.

**Critérios de aceitação.**

- cada dispositivo é admitido, identificado, revogável e limitado por capacidade;
- as superfícies projetam o mesmo catálogo, estados, consentimentos e resultados;
- o operador recebe atenção proativa quando uma condição exige decisão;
- perda de conexão não duplica trabalho nem perde o cursor de acompanhamento;
- resultado remoto é limitado e redigido; não vira shell remoto genérico;
- uma operação iniciada em uma superfície pode ser acompanhada em outra.

**Estado: Parcial.** O catálogo de operações e as projeções Termux/PWA estão documentados como
entregues; confirmação continuada do operador e Telegram como projeção do mesmo contrato permanecem
próximos. Entrega proativa, enrolment completo e política multi-dispositivo ainda não fecham o
resultado cotidiano.

### R8. Integrações como conexões governadas

**Necessidade.** Reduzir a administração direta de Teams, Outlook, Gmail, WhatsApp, Telegram,
navegadores e futuros serviços sem entregar autoridade ilimitada a uma automação.

**Critérios de aceitação.** Para cada integração:

- identidade/conta, credencial e escopo de autorização são declarados;
- status de conexão distingue `up`, `down` e `unknown`;
- leitura, busca, rascunho, envio, alteração e exclusão são capacidades separadas;
- ações externas mantêm idempotência, consentimento e registro de resultado;
- segredos não entram em prompts, logs, manifests ou bundles diagnósticos;
- falha produz recuperação executável e não uma suposição de sucesso;
- regras específicas do provedor ficam no adaptador, não no core.

**Estado: Parcial/Ausente por provedor.** Há contratos e provas para conexões, login flows, delivery,
Telegram e automação web. Isso não equivale a integrações operacionais completas com Teams,
Outlook, Gmail ou WhatsApp; cada uma precisa de inventário de capacidades, ameaça, consentimento e
prova real antes de ser declarada entregue.

### R9. Memória contextual e conhecimento durável

**Necessidade.** Usar repositórios, vaults Markdown/Obsidian, sessões e grafo como memória
contextual recuperável, sem depender da memória privada de um modelo.

**Critérios de aceitação.**

- uma fonte pode ser arquivo, repositório, grafo ou injeção, mas converge para contrato comum;
- proveniência, versão e autoridade acompanham o conteúdo;
- leitura e indexação não implicam permissão de escrita;
- contexto relevante é recuperável por workspace, tarefa e sessão;
- decisões e requisitos duráveis vivem em fonte versionada;
- conhecimento sensível respeita fronteiras pessoal, profissional e coletiva.

**Estado: Parcial.** Há contratos para source, records, vault, provenance, sync e sessões, além de
provas de convergência. A intake de conhecimento para o agente, a migração do vault profissional e
a busca contextual integrada ao cotidiano ainda não estão provadas ponta a ponta.

### R10. Aprendizado e cultivo entre ecossistemas

**Necessidade.** Aprender com `pi.dev` via `agents-lab` e com consumidores reais sem copiar
acidentalmente seus resíduos, acoplamentos ou políticas.

**Critérios de aceitação.**

- toda importação identifica a necessidade e a evidência externa;
- o padrão é testado em isolamento antes de promoção;
- um bloco sobe para Refarm apenas quando é genérico e tem pressão real;
- o consumidor prova a compatibilidade por contrato, pacote ou adaptador;
- a origem e alternativas rejeitadas ficam documentadas;
- compatibilidade não transforma arquivos `.pi` em dependência do runtime Refarm.

**Estado: Parcial.** O método de assimilação e várias provas de segundo consumidor existem. O
launcher isolado/paridade inspirado pelo `agents-lab` e o intake de declarações curadas ainda estão
incompletos.

### R11. Segurança, privacidade e reversibilidade

**Necessidade.** Poder ampliar autonomia sem ampliar silenciosamente o raio de dano.

**Critérios de aceitação.**

- autoridade é capability-scoped e revogável;
- ações externas ou destrutivas têm preview/consentimento proporcional ao risco;
- operações repetidas são idempotentes ou detectam duplicação;
- dados sensíveis são minimizados, redigidos e separados por escopo;
- bundles diagnósticos são locais, sanitizados e revisáveis antes de compartilhar;
- toda mutação material informa alvo, resultado e possibilidade de recuperação;
- workspaces profissionais e coletivos não herdam política pessoal por conveniência.

**Estado: Parcial.** Existem contratos de autorização, consentimento, credenciais, trust, hardening e
diagnóstico sanitizado. A segurança precisa ser provada por jornada de integração e nó, não pela
presença desses pacotes.

### R12. Visão executiva e prestação de contas

**Necessidade.** Ver avanço real sem administrar manualmente vários pratos e sem confundir atividade
com resultado.

**Critérios de aceitação.** Uma visão diária/semanal deve responder:

- o que avançou, ficou parcial, falhou ou está bloqueado;
- quanto tempo, tokens e dinheiro foram consumidos, por workspace e finalidade;
- quais compromissos, mensagens ou prazos exigem atenção;
- quais automações estão ativas e qual foi sua última evidência;
- quais divergências, dívidas e riscos estão acumulando custo;
- qual é a próxima ação de maior valor e por que ela supera as alternativas;
- quais dados são completos, truncados, estimados ou desconhecidos.

**Estado: Ausente como visão integrada.** Há registros, handoffs, status e instrumentos parciais,
mas não existe ainda uma prestação de contas única que cubra trabalho interno e externo. Construir
a visualização antes de fechar as semânticas do ledger apenas apresentaria uma falsa precisão.

## Jornada mínima de confiança

O operador poderá chamar o Refarm de superfície diária primária quando esta jornada for repetível:

1. abre Telegram, Termux ou PWA e recebe contexto atual, atenção pendente e custo recente;
2. escolhe um workspace e declara uma intenção com resultado esperado;
3. o Refarm resolve nó, sessão, política, credencial, orçamento e capacidade sem ambiguidade;
4. o trabalho é despachado e pode progredir sem manter a superfície aberta;
5. consentimentos chegam com contexto suficiente e autoridade limitada;
6. o operador acompanha, cancela ou redireciona por qualquer superfície admitida;
7. o resultado retorna com evidência, impacto, custo e pendências;
8. a memória relevante é atualizada somente na fonte autorizada;
9. o resumo diário/semanal distingue resultado, esforço, dívida e desconhecido;
10. após falha ou troca de dispositivo, `resume` reconstrói a continuidade sem conhecimento oculto.

## Gates de confiança

Os gates abaixo complementam, sem substituir, os gates técnicos existentes.

| Gate | Pergunta | Evidência mínima |
| --- | --- | --- |
| **Assistido** | O Refarm reduz trabalho mesmo com um especialista perto? | Loop real `resume → dispatch → observe → finish`, recuperação executável e ledger do esforço. |
| **Primário** | O operador pode passar a maior parte do dia fora de IDEs e apps fornecedores? | Jornada mínima repetida em dois workspaces e duas superfícies, sem perda de contexto ou custo. |
| **Autônomo supervisionado** | O sistema progride sozinho dentro de limites explícitos? | Automação recorrente, consentimento, cancelamento, deadline, evidência e prestação de contas. |
| **Multi-nó** | Outro dispositivo pode iniciar e acompanhar sem criar uma segunda verdade? | Identidade, enrolment, revogação, cursor e contexto soberano provados em dois nós. |
| **Integração confiável** | Uma plataforma externa pode ser operada sem abrir seu app na rotina normal? | Jornada provider-specific real, escopos separados, recuperação, idempotência e auditoria. |
| **Prestação total** | O operador sabe onde gastou esforço e o que obteve? | Cobertura declarada, ingestão externa, agregação por eixos e exposição explícita de lacunas. |

## Ordem de cultivo derivada dos requisitos

Esta ordem reduz o risco de construir superfícies bonitas sobre dados incompletos:

1. **Semântica e cobertura do ledger:** distinguir o que o Refarm mede do que ainda não vê; criar o
   contrato de ingestão externa antes de prometer totalidade.
2. **Isolamento e contexto:** concluir launcher/paridade e impedir que testes contaminem ledger real.
3. **Consulta e prestação básica:** agregação por workspace, nó, superfície e modelo, com paginação e
   truncamento honestos.
4. **Despacho supervisionado:** automação, avaliação de resultado, deadline, cancelamento e
   consentimento no mesmo contrato.
5. **Jornada multi-superfície:** confirmar Termux/PWA e adicionar Telegram como projeção, não como
   executor paralelo.
6. **Pressão de trabalho real:** operar `agents-lab`, `rcdc5` e vaults de forma incremental e
   registrar apenas as lacunas realmente encontradas.
7. **Integrações externas:** uma por vez, escolhida por alívio cotidiano e capacidade de provar a
   jornada completa.
8. **Visão executiva:** compor o resumo diário/semanal quando a base puder declarar sua cobertura.

Falhas reais de execução e segurança continuam tendo precedência sobre esta ordem.

## Decisões que permanecem com o operador

Estas perguntas mudam política, privacidade ou prioridade e não devem ser fechadas por inferência:

1. Qual evento externo entra automaticamente no ledger, e qual exige confirmação ou correção antes
   de se tornar registro soberano?
2. Qual integração produziria maior alívio primeiro: comunicação profissional, e-mail/calendário,
   WhatsApp, ou automação web de um fluxo específico?
3. Que conteúdo pode atravessar as fronteiras pessoal, profissional e coletiva, mesmo quando duas
   contas pertencem ao mesmo operador?
4. Quais ações podem ser pré-autorizadas por política e quais sempre exigem consentimento humano?
5. Qual é a cadência de prestação de contas desejada e quais métricas representam progresso de
   verdade para vida pessoal e trabalho?
6. Quanto tempo/custo o Refarm pode gastar por dia ou workspace tentando reduzir dívida do próprio
   Refarm antes de voltar ao trabalho externo?
7. Uma divergência que o agente não tem autoridade para corrigir deve bloquear o gate ou permanecer
   como aviso explícito?

As respostas devem ser incorporadas aqui ou em ADRs/specs ligados, nunca mantidas apenas em uma
conversa.

## Protocolo para próximas rodadas

Ao iniciar uma fatia relevante, o agente deve:

1. rodar o loop de resume/check e inspecionar trabalho paralelo;
2. nomear quais requisitos `R1`–`R12` a fatia serve;
3. declarar a evidência que elevará o estado, antes de implementar;
4. preferir a menor mudança que prova uma jornada real;
5. atualizar o documento de execução apropriado, sem transformar este baseline em changelog;
6. não elevar um requisito a **Provado** sem evidência executada;
7. registrar lacunas de observação como lacunas, não como sucesso vazio.

## Próxima revisão

Este baseline deve ser revisado depois de uma entrevista curta sobre as sete decisões acima e após a
primeira jornada externa completa capturada pelo ledger. Até lá, ele é suficientemente específico
para impedir expansão oportunista, mas não substitui as escolhas do operador sobre privacidade,
prioridade e autonomia.
