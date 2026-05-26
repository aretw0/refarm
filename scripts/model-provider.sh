#!/usr/bin/env sh

read_model_provider_from_json_file() {
  file="$1"

  if [ ! -f "$file" ] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  node -e "try{const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const route=c.modelRoutes?.default||c.tokens?.modelRoutes?.default;const routeProvider=typeof route==='string'&&route.includes('/')?route.split('/')[0]:'';process.stdout.write(c.provider||c.default_provider||c.modelProvider||c.tokens?.modelProvider||routeProvider||'')}catch{}" "$file" 2>/dev/null || true
}

resolve_refarm_model_provider() {
  root="$1"

  if [ -n "${MODEL_PROVIDER:-}" ]; then
    printf "%s" "$MODEL_PROVIDER"
    return
  fi

  if [ -n "${MODEL_DEFAULT_PROVIDER:-}" ]; then
    printf "%s" "$MODEL_DEFAULT_PROVIDER"
    return
  fi

  provider="$(read_model_provider_from_json_file "$root/.refarm/config.json")"
  if [ -n "$provider" ]; then
    printf "%s" "$provider"
    return
  fi

  operator_identity="${REFARM_OPERATOR_IDENTITY_FILE:-$HOME/.refarm/identity.json}"
  provider="$(read_model_provider_from_json_file "$operator_identity")"
  if [ -n "$provider" ]; then
    printf "%s" "$provider"
    return
  fi

  provider="$(read_model_provider_from_json_file "$root/.refarm/identity.json")"
  if [ -n "$provider" ]; then
    printf "%s" "$provider"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node -e "import(process.argv[1]).then(m=>process.stdout.write(m.DEFAULT_MODEL_PROVIDER)).catch(()=>process.stdout.write('openai'))" "$root/packages/config/src/model-routing.js" 2>/dev/null || true
    return
  fi

  printf "openai"
}
