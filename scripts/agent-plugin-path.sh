#!/usr/bin/env bash
# agent-plugin-path.sh — decide WHICH installed agent copy the daemon loads.
#
# Sourced by scripts/tractor-start.sh. It lives in its own sourceable file for the same
# reason scripts/model-provider.sh does: the decision is testable that way, without
# starting a daemon (see scripts/ci/test-runtime-start-helpers.mjs).
#
# Background — the defect this encodes the recovery for. There used to be TWO installers
# writing TWO directories: `refarm plugin install` wrote
# `$REFARM_HOME/plugins/refarm_agent/` (the CLI's `pluginIdToFsToken` layout, which
# `.versions` already keys on), while `scripts/agent-install.mjs` wrote the npm-shaped
# `$REFARM_HOME/plugins/@refarm/agent/` and the start script hardcoded THAT as the path
# it loaded. There is one installer now, and one path function; the scoped directory is
# LEGACY — read as a fallback so a node installed before the convergence still boots,
# never written, and never silent.

# resolve_installed_agent_plugin <canonical_wasm> <legacy_wasm>
#
# Prints the wasm path the daemon should load, or NOTHING when neither install is
# present (the caller then keeps the freshly compiled build). Notices go to stderr, so a
# caller can capture the path with $(...) and the human still sees what was decided.
resolve_installed_agent_plugin() {
  local canonical="${1:-}"
  local legacy="${2:-}"

  if [ -n "$canonical" ] && [ -f "$canonical" ]; then
    if [ -n "$legacy" ] && [ -f "$legacy" ]; then
      echo "   ℹ  A legacy agent install is still on this node, and is NOT being loaded:" >&2
      echo "        $(dirname "$legacy")" >&2
      echo "      The loaded copy is the one 'refarm plugin install' writes:" >&2
      echo "        $canonical" >&2
      echo "      Nothing writes the legacy directory anymore. Remove it when you are ready:" >&2
      echo "        rm -rf \"$(dirname "$legacy")\"" >&2
    fi
    printf '%s' "$canonical"
    return 0
  fi

  if [ -n "$legacy" ] && [ -f "$legacy" ]; then
    echo "   ⚠  Loading the agent from the LEGACY install directory:" >&2
    echo "        $legacy" >&2
    echo "      This node predates the one-installer convergence, and nothing writes that" >&2
    echo "      directory anymore — so it will never pick up a rebuilt agent. Converge it:" >&2
    echo "        refarm plugin install --bundled" >&2
    printf '%s' "$legacy"
    return 0
  fi

  return 0
}
