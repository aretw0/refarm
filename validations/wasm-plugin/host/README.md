# WASM Plugin Host - Validação

Host TypeScript que carrega o plugin `hello-world-plugin.wasm` e valida comunicação via WIT.

## Setup

```bash
# Instalar dependências
npm install

# Copiar WASM compilado
copy ..\hello-world\target\wasm32-wasip1\release\hello_world_plugin.wasm public\hello-world-plugin.wasm

# Rodar desenvolvimento
npm run dev
```

No Dev Container (Linux), use o equivalente:

```bash
cp ../hello-world/target/wasm32-wasip1/release/hello_world_plugin.wasm public/hello-world-plugin.wasm
```

Abra <http://localhost:5173> no browser.

## Fluxo de Validação

1. **Load Plugin**: Fetch `.wasm` e instancia via jco
2. **Setup**: Chama `plugin.setup()` (init)
3. **Ingest**: Chama `plugin.ingest()` (gera JSON-LD → store-node)
4. **Metadata**: Retorna metadados do plugin
5. **Teardown**: Cleanup antes de descarregar

## Métricas Observadas

- ✅ Load time < 100ms (target)
- ✅ Setup time < 10ms (target)
- ✅ Ingest time < 10ms (target)
- ✅ WASM size < 500KB (target)

## Substituir Mock por jco Real

Atualmente o `main.ts` usa um mock. Para usar o plugin WASM real:

```typescript
import { instantiate } from '@bytecodealliance/jco';

const { instance } = await instantiate(wasmBytes, {
  'refarm:sdk/kernel-bridge': kernelBridge
});

pluginInstance = instance.exports as PluginInstance;
```

**Nota**: Verifique compatibilidade do jco v1.4+ com WASM Component Model.
