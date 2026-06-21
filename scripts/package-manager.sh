#!/usr/bin/env sh

resolve_package_manager() {
  root="$1"

  if [ -n "${REFARM_PACKAGE_MANAGER:-}" ]; then
    printf "%s" "${REFARM_PACKAGE_MANAGER%%@*}"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node -e "try{const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).packageManager||'npm';process.stdout.write(p.split('@')[0])}catch{process.stdout.write('npm')}" "$root/package.json"
    return
  fi

  printf "npm"
}

script_command_for_package_manager() {
  package_manager="$1"
  script="$2"

  case "$package_manager" in
    pnpm) printf "pnpm run %s" "$script" ;;
    npm) printf "npm run %s" "$script" ;;
    yarn) printf "yarn run %s" "$script" ;;
    bun) printf "bun run %s" "$script" ;;
    *) printf "%s run %s" "$package_manager" "$script" ;;
  esac
}

run_script_for_package_manager() {
  package_manager="$1"
  script="$2"
  shift 2

  case "$package_manager" in
    pnpm|npm|yarn|bun) "$package_manager" run "$script" "$@" ;;
    *) "$package_manager" run "$script" "$@" ;;
  esac
}

install_command_for_package_manager() {
  package_manager="$1"
  frozen="${2:-false}"

  case "$package_manager:$frozen" in
    pnpm:true) printf "pnpm install --frozen-lockfile" ;;
    pnpm:*) printf "pnpm install" ;;
    npm:true) printf "npm ci" ;;
    npm:*) printf "npm install" ;;
    yarn:true) printf "yarn install --immutable" ;;
    yarn:*) printf "yarn install" ;;
    bun:true) printf "bun install --frozen-lockfile" ;;
    bun:*) printf "bun install" ;;
    *:true) printf "%s install" "$package_manager" ;;
    *) printf "%s install" "$package_manager" ;;
  esac
}

install_for_package_manager() {
  package_manager="$1"
  frozen="${2:-false}"
  shift 2

  case "$package_manager:$frozen" in
    pnpm:true) pnpm install --frozen-lockfile "$@" ;;
    pnpm:*) pnpm install "$@" ;;
    npm:true) npm ci "$@" ;;
    npm:*) npm install "$@" ;;
    yarn:true) yarn install --immutable "$@" ;;
    yarn:*) yarn install "$@" ;;
    bun:true) bun install --frozen-lockfile "$@" ;;
    bun:*) bun install "$@" ;;
    *:*) "$package_manager" install "$@" ;;
  esac
}

audit_high_command_for_package_manager() {
  package_manager="$1"

  case "$package_manager" in
    pnpm) printf "pnpm audit --audit-level=high --silent" ;;
    npm) printf "npm audit --audit-level=high --silent" ;;
    yarn) printf "yarn npm audit --severity high" ;;
    bun) printf "bun audit" ;;
    *) printf "%s audit" "$package_manager" ;;
  esac
}

audit_high_for_package_manager() {
  package_manager="$1"
  shift

  case "$package_manager" in
    pnpm) pnpm audit --audit-level=high --silent "$@" ;;
    npm) npm audit --audit-level=high --silent "$@" ;;
    yarn) yarn npm audit --severity high "$@" ;;
    bun) bun audit "$@" ;;
    *) "$package_manager" audit "$@" ;;
  esac
}

workspace_exec_command_for_package_manager() {
  package_manager="$1"
  workspace="$2"
  binary="$3"
  shift 3

  case "$package_manager" in
    pnpm) printf "pnpm -C %s exec %s" "$workspace" "$binary" ;;
    npm) printf "npm --prefix %s exec -- %s" "$workspace" "$binary" ;;
    yarn) printf "yarn --cwd %s %s" "$workspace" "$binary" ;;
    bun) printf "bun --cwd %s x %s" "$workspace" "$binary" ;;
    *) printf "%s exec %s" "$package_manager" "$binary" ;;
  esac

  for arg in "$@"; do
    printf " %s" "$arg"
  done
}

workspace_exec_for_package_manager() {
  package_manager="$1"
  workspace="$2"
  binary="$3"
  shift 3

  case "$package_manager" in
    pnpm) pnpm -C "$workspace" exec "$binary" "$@" ;;
    npm) npm --prefix "$workspace" exec -- "$binary" "$@" ;;
    yarn) yarn --cwd "$workspace" "$binary" "$@" ;;
    bun) bun --cwd "$workspace" x "$binary" "$@" ;;
    *) "$package_manager" exec "$binary" "$@" ;;
  esac
}
