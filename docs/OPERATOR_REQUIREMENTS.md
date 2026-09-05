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

Os doze resultados exigidos vivem em `.project/requirements.json`, o registro governado — com a
necessidade, os critérios de aceitação, o estado de maturidade e a evidência de cada um, **verbatim**
como foram escritos nesta seção em 2026-08-06. A relocação foi provada, não confiada: 117 strings
extraídas, todas encontradas na fonte depois de desfeita a quebra de linha.

Esta tabela é o **índice**, e a divergência entre ela e o registro é **bloqueada pelo gate**
(`scripts/ci/project-block-consistency.mjs`). Ela existe para ser lida de relance; o registro existe
para ser lido por instrumento.

| Id | Resultado | Maturidade |
| --- | --- | --- |
| R1 | Continuidade operacional | parcial |
| R2 | Estado soberano inequívoco | parcial |
| R3 | Ledger universal de trabalho | parcial |
| R4 | Orçamento sustentável e explicável | parcial |
| R5 | Workspaces como unidades de contexto e responsabilidade | parcial |
| R6 | Despacho governado e supervisão | parcial |
| R7 | Operação por dispositivos e superfícies leves | parcial |
| R8 | Integrações como conexões governadas | parcial |
| R9 | Memória contextual e conhecimento durável | parcial |
| R10 | Aprendizado e cultivo entre ecossistemas | parcial |
| R11 | Segurança, privacidade e reversibilidade | parcial |
| R12 | Visão executiva e prestação de contas | ausente |

Para ler um resultado por inteiro, para saber quantos itens abertos separam você de qualquer um
deles, ou para mover uma maturidade:

```bash
refarm requirements list --workspace refarm --json
refarm issues list --workspace refarm --requirement R7 --json
refarm issues list --workspace refarm --unserved --json
refarm requirements set-maturity --workspace refarm --id R7 --maturity provado --evidence <ref>
```

`set-maturity` recusa elevar a `provado` sem `--evidence`, que é a regra 6 do protocolo desta própria
página. A prosa não foi resumida ao mudar de arquivo — `refarm requirements list --json` devolve cada
campo inteiro, e a seção original está em `git show a7d3f147:docs/OPERATOR_REQUIREMENTS.md`.

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
