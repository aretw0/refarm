# Política de Licenciamento (Refarm Ecosystem)

A arquitetura do Refarm é intrinsecamente desenhada para devolver o **pertencimento digital (Digital Sovereignty)** aos usuários. Isso significa que, do ponto de vista do código-fonte, o ecossistema age tanto como um "bem público digital" inalienável quanto como um "solo fértil" onde a iniciativa privada e desenvolvedores livres podem cultivar e lucrar com suas próprias engenharias (Plugins).

Para garantir esse delicado balanço de poderes — protegendo a liberdade do usuário final de corporações enquanto permite um comércio vibrante de plugins — o repositório Monorepo do Refarm adota um modelo de **Licenciamento Multi-Camada (Multi-Tier Licensing)**.

---

## 🏗️ 1. O Core e os Aplicativos Vitais: \`GNU AGPLv3\`

> **O que é afetado:**
>
> - `apps/homestead` (A Interface Principal do Usuário)
> - `packages/tractor` (O Motor Soberano / Microkernel)
> - `packages/sower` (Plugin de Onboarding / Futura CLI de Scaffolding)
> - Plugins Nativos (`plugin-antenna`, `plugin-scarecrow`, etc., criados pela equipe Core).

Esses pacotes são o coração da liberdade do projeto. A licença **GNU Affero General Public License v3.0 (AGPL-3.0)** foi rigorosamente escolhida para garantir que:

1. **Proteção contra Enclausuramento (Cloud Loophole):** Se uma megacorporação (como Google, Meta, ou AWS) pegar o `Tractor` ou o `Homestead`, modificá-lo para rodar remotamente como um "SaaS (Software as a Service)", e oferecer aos usuários pela rede, **ela é obrigada por lei a abrir o código-fonte de toda a infraestrutura modificada** de volta para a comunidade.
2. **Propriedade Comum:** O maquinário pesado da fazenda sempre pertencerá à coletividade. Ninguém pode privatizar a fundação.

## 🌉 2. Os SDKs, Contratos e Templates: \`MIT\` / \`Apache 2.0\`

> **O que é afetado:**
>
> - `packages/storage-contract-v1`
> - `packages/identity-contract-v1`
> - `packages/sync-contract-v1`
> - `packages/plugin-manifest`
> - Arquivos WIT (`refarm-sdk.wit`)
> - Todo o diretório de templates (`templates/*` e `examples/*`).

Se os contratos de integração fossem licenciados sob AGPLv3, a licença seria "viral" e infectaria os plugins. Nós não queremos isso. Para o verdadeiro "Sovereign Computing" decolar, empresas privadas devem poder criar plugins de altíssima qualidade (mesmo que de código fechado/comercial) para interagir com o Tractor.

Para garantir que desenvolvedores externos possam construir e até cobrar por plugins com segurança jurídica, adotamos licenças ultra-permissivas (**MIT** ou **Apache 2.0**) exclusivamente nas pontes de integração (Contratos).

Isso estabelece um "Airlock" Jurídico:

- O **Tractor** exige que a liberdade seja devolvida (AGPLv3).
- Os **Contratos e SDKs** permitem integração livre, possibilitando que plugins terceirizados possam ser AGPL, MIT, comerciais, ou completamente *Closed-Source*.

---

## 🛠️ Qual é a regra geral para nós (mantenedores)?

Quando criarmos um novo pacote (`npm create ...`):

1. **É um SDK que terceiros instalarão como dependência `npm` para compilar código próprio?**
   O pacote será **MIT** e não poderá conter lógica de negócios do Refarm, apenas assinaturas TypeScript ou exportação de interfaces WIT.
2. **É algo prático (Tractor, Plugin funcional, App de React)?**
   O pacote será invariavelmente **AGPLv3**.
3. **É um conteúdo documental ou de design (SVG, Brand)?**
   Preferencialmente **CC-BY-SA 4.0** (Creative Commons).

---

> *"O Refarm é GNU AGPLv3. Se você usar nossa terra para plantar em grande escala via SaaS, você tem de nos devolver fertilizante. Mas se você usar nossos SDKs (MIT) para trazer suas próprias máquinas (Plugins Proprietários) para trabalhar dentro da fazenda soberana dos seus clientes locais, você é mais do que bem-vindo."*
