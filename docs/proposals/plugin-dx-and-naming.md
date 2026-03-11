# Proposta: Plugin DX, Naming & Environment

## 1. Nomenclatura Temática (The Theme)

No SilverBullet eles se chamam "Plugs". No Refarm, já que nossa metáfora raiz é a Fazenda, o Solo, as Sementes e o Trator, aqui estão algumas propostas de como chamar nossos Plugins (WASM Components):

- **Implements (Implementos):** Um trator não faz nada sozinho, ele precisa de implementos (arados, colheitadeiras, plantadeiras) engatados na tomada de força (PTO = nossa interface WIT).
  - *Exemplo:* "Vamos instalar o Implemento de Pagamentos no Tractor."
- **Grafts (Enxertos):** Conecta bem com a ideia de Árvores/Grafos. Você enxerta uma nova funcionalidade no tronco principal.
- **Seeds (Sementes):** Plugins pequenos que crescem e tomam conta de uma área de dados no seu Grafo.
- **Sprouts (Brotos):** Módulos que adicionam vida nova ao sistema.

*(Minha recomendação forte: **Implements**. Combina perfeitamente com o kernel se chamar `Tractor`!)*

## 2. Padronização de Logs (DX)

Os plugins (feitos em Rust, Go, TS) já têm `stdout` e `stderr` naturais via WASI. O host (Tractor) intercepta isso hoje.
Porém, "texto puro" no `stdout` perde semântica.

**A Solução DX:**
Devemos definir uma interface no arquivo WIT (ex: `refarm:environment/logger`) que expõe:

```wit
interface logger {
    enum level { debug, info, warn, error }
    log: func(lvl: level, msg: string)
}
```

**Por que?** Porque assim, quando um plugin chama `logger.log(warn, "Demorou muito")`, o Tractor (Host) recebe isso de forma estruturada, com metadados do autor do plugin, timestamp exato, e pode repassar isso direitinho para o console do DevTools do navegador *com cores*, ou mandar para um serviço de telemetria se estiver rodando no Cloud. E claro, nós podemos criar macros em Rust (`tractor_log::info!()`) para a experiência na linguagem raiz ser 100% transparente.

## 3. Consciência de Ambiente (Environment Awareness)

Você está certo. O plugin precisa saber onde está pisando. O Astro expõe `Astro.locals` ou variáveis de ambiente para decidir entre cliente e servidor.
Para os WASM Plugins, também podemos passar isso no instante da carga ou expor como um Host Call (Syscall, como o Silverbullet chama).

**Exemplo de Interface:**

```wit
interface runtime {
    enum target { browser, edge, cloud, desktop }
    
    /// Retorna onde o kernel está executando agora
    current-target: func() -> target
    
    /// Retorna se o usuário está online na rede P2P
    is-online: func() -> bool
}
```

Isso impede que os desenvolvedores criem dependências rígidas com "abstrações mágicas" que falham silenciosamente. Se o plugin de Inteligência Artificial sabe que está no `browser`, ele usa um modelo GGUF menor; se ele chama `current-target()` e vê `edge`, ele faz uma call remota; se vê `cloud`, ele carrega o modelo gigante na GPU.
