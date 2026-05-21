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
