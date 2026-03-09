# Logging Strategy

## Princípios

Refarm usa os níveis nativos de console apropriadamente, sem flags customizadas:

- **`console.debug()`**: Logs verbosos para debugging (plugin loading details, WASM size, call tracing)
- **`console.info()`**: Eventos importantes mas não críticos (boot success, identity transitions)
- **`console.warn()`**: Problemas não-críticos (blocked requests, falhas recuperáveis)
- **`console.error()`**: Erros críticos que impedem funcionamento

## Controle por Ambiente

### Development
- Browser: Todos os níveis visíveis (incluindo debug)
- Node.js: Use `NODE_ENV=development` ou `DEBUG=refarm:*` para habilitar debug logs

### Production  
- Browser: `console.debug()` é automaticamente filtrado
- Node.js: `NODE_ENV=production` suprime debug logs

### Tests & Benchmarks
- Vitest: Use `--reporter=basic` ou `--silent` para suprimir output
- Vitest config: `silent: true` no ambiente de teste
- Ou mock console: `vi.spyOn(console, 'debug').mockImplementation(() => {})`

## Exemplos

```typescript
// ✅ Correto: detalhes de debug para desenvolvedores
console.debug(`[tractor] Fetching plugin WASM: ${wasmUrl}`);
console.debug(`[tractor] WASM loaded: ${size} KB`);

// ✅ Correto: evento importante
console.info("[tractor] Booted ✓");

// ✅ Correto: aviso não-crítico
console.warn(`[tractor] Blocked unauthorized fetch to ${url}`);

// ❌ Errado: flag customizada
if (!this.silent) console.log(...);
```

## Rationale

Usar os níveis nativos de console ao invés de flags customizadas:
1. **Padrão da indústria**: Todo desenvolvedor entende console.debug vs console.info
2. **Zero config**: Funciona out-of-the-box em todos os ambientes
3. **Ferramenta-agnóstico**: Não precisa de configuração especial em cada test runner
4. **Produção-safe**: console.debug é naturalmente filtrado em prod
5. **Manutenível**: Não adiciona surface area de API customizada
