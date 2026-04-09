# Estratégia de Centralização de Ambiente com Turborepo

Este documento detalha como o Turborepo é utilizado como a "fonte da verdade" para a preparação do ambiente de desenvolvimento e CI no monorepo Refarm, simplificando o `devcontainer.json`, o `post-create.sh` e os workflows do GitHub Actions.

## A Visão: "Ambiente como Código via Turbo"

A estratégia implementada move a **preparação de ferramentas e dependências** para tarefas do Turborepo. Isso permite que o cache do Turbo (local ou remoto) gerencie a validade dessas ferramentas, eliminando a necessidade de mounts complexos e caches de CI redundantes.

## 1. Otimização do `turbo.json`

Adicionamos tarefas de "setup" ao `turbo.json` que possuem `inputs` e `outputs` bem definidos para aproveitar o cache do Turbo. Isso garante que ferramentas como `wasm-tools`, `cargo-component` e os navegadores do Playwright sejam instaladas e cacheadas de forma eficiente.

```json
{
  "tasks": {
    "setup:rust-tools": {
      "inputs": ["scripts/setup-rust-tools.sh"],
      "outputs": ["/usr/local/cargo/bin/cargo-component", "/usr/local/cargo/bin/wasm-tools"],
      "cache": true
    },
    "setup:playwright": {
      "inputs": ["package-lock.json"],
      "outputs": ["/home/vscode/.cache/ms-playwright/**"],
      "cache": true
    },
    "build": {
      "dependsOn": ["^build", "setup:rust-tools"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**", ".astro/**", "pkg/**", "target/**"]
    }
  }
}
```

### Vantagens:
*   **Idempotência**: Se as ferramentas já estiverem instaladas e o cache estiver válido, o Turbo simplesmente "restaura" o estado em milissegundos.
*   **Consistência**: O comando `turbo run setup:rust-tools` funcionará de forma idêntica no DevContainer, no GitHub Actions e na máquina local.
*   **Redução de Redundância**: Não precisamos de uma lógica de cache separada no GitHub Actions para `cargo-component` se o Turbo já estiver gerenciando o cache da pasta `.turbo`.

## 2. Simplificação do DevContainer

Com o Turbo gerenciando as ferramentas, o `post-create.sh` foi refatorado para ser mais conciso e o `devcontainer.json` teve seus `mounts` simplificados.

### `post-create.sh` Refatorado:

O script `post-create.sh` agora delega a instalação de ferramentas ao Turborepo, focando apenas em permissões e na instalação de dependências NPM (que ainda se beneficia do cache do `npm ci`).

```bash
#!/usr/bin/env bash
# .devcontainer/post-create.sh - Optimized setup for Refarm using Turborepo
set -euo pipefail

echo "[refarm-devcontainer] Starting optimized post-create setup..."

# 1. Fix permissions for mounted volumes
# Ensure vscode user owns the npm, turbo, and playwright cache directories.
# Rust/Cargo volumes mount as root/rustlang; ensure vscode can write to bin and rustup if needed
echo "[refarm-devcontainer] Fixing permissions for mounted caches..."
mkdir -p /home/vscode/.npm /home/vscode/.turbo /home/vscode/.cache/ms-playwright
sudo chown -R vscode:vscode /home/vscode/.npm /home/vscode/.turbo /home/vscode/.cache/ms-playwright
sudo chown -R vscode:rustlang /usr/local/cargo /usr/local/rustup
chmod -R g+w /usr/local/cargo /usr/local/rustup

# 2. Rust Toolchain setup (fast)
echo "[refarm-devcontainer] Adding Rust WASM targets..."
rustup default stable
rustup target add wasm32-unknown-unknown
rustup target add wasm32-wasip1 || true
rustup component add rust-src

# 3. Install specialized WASM tooling via Turborepo
echo "[refarm-devcontainer] Installing specialized WASM tooling via Turborepo..."
npx turbo run setup:rust-tools

# 4. Install Playwright browsers via Turborepo
echo "[refarm-devcontainer] Installing Playwright browsers via Turborepo..."
npx turbo run setup:playwright

# 5. NPM Dependencies
# npm ci is still run here to ensure node_modules are installed for the current project.
# The Turborepo cache for node_modules is not as effective as npm's own cache.
if [ -f package-lock.json ]; then
  echo "[refarm-devcontainer] Running npm ci..."
  npm ci
else
  echo "[refarm-devcontainer] No package-lock.json discovered, running npm install..."
  npm install
fi

# 6. Finalize Environment
echo "[refarm-devcontainer] Finalizing setup..."
npm run hooks:install || true

echo "[refarm-devcontainer] Tool versions:"
rustc --version
cargo --version
cargo-component --version || true
wasm-tools --version || true
node --version

echo "[refarm-devcontainer] Setup complete."
```

### `devcontainer.json` Simplificado:

Os `mounts` para `refarm-playwright-cache` e `refarm-cargo-bin` foram removidos, pois o Turborepo agora gerencia o cache desses artefatos, e o `cargo-bin` é coberto pelo mount de `refarm-cargo-registry` e `refarm-cargo-git` que já incluem o diretório `cargo`.

```json
{
  "name": "refarm-dev",
  "build": {
    "dockerfile": "Dockerfile",
    "context": "."
  },
  "runArgs": ["--memory=4g", "--cpus=2"],
  "features": {
    "ghcr.io/devcontainers/features/rust:1": {
      "version": "stable",
      "profile": "minimal"
    },
    "ghcr.io/devcontainers/features/common-utils:2": {
      "installZsh": false,
      "username": "vscode"
    }
  },
  "remoteUser": "vscode",
  "containerEnv": {
    "CARGO_TERM_COLOR": "always",
    "TURBO_CACHE_DIR": "/home/vscode/.turbo"
  },
  "mounts": [
    "source=refarm-npm-cache,target=/home/vscode/.npm,type=volume",
    "source=refarm-cargo-registry,target=/usr/local/cargo/registry,type=volume",
    "source=refarm-cargo-git,target=/usr/local/cargo/git,type=volume",
    "source=refarm-rustup,target=/usr/local/rustup,type=volume",
    "source=refarm-turbo-cache,target=/home/vscode/.turbo,type=volume"
  ],
  "postCreateCommand": "bash .devcontainer/post-create.sh",
  "customizations": {
    "vscode": {
      "extensions": [
        "rust-lang.rust-analyzer",
        "vadimcn.vscode-lldb",
        "astro-build.astro-vscode",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint",
        "nhoizey.gremlins",
        "arr.marksman",
        "MermaidChart.vscode-mermaid-chart",
        "DavidAnson.vscode-markdownlint",
        "ms-playwright.playwright"
      ],
      "settings": {
        "terminal.integrated.defaultProfile.linux": "bash",
        "rust-analyzer.lru.capacity": 44,
        "rust-analyzer.check.command": "check",
        "rust-analyzer.checkOnSave": true,
        "rust-analyzer.linkedProjects": ["./packages/tractor/Cargo.toml"]
      }
    }
  }
}
```

## 3. Simplificação do GitHub Actions

O workflow `.github/actions/setup/action.yml` foi otimizado para usar as novas tarefas de setup do Turborepo, removendo caches e instalações manuais redundantes.

```yaml
name: "Refarm Setup"
description: "Centralized setup: Node.js and npm ci."

inputs:
  node-version:
    description: "Node.js version"
    required: false
    default: "22"
  playwright-setup:
    description: "Whether to setup Playwright browsers"
    required: false
    default: "false"
  rust-target:
    description: "Rust targets install (e.g. wasm32-wasip1). Multiple targets can be separated by commas."
    required: false
    default: "wasm32-wasip1,x86_64-unknown-linux-gnu"

runs:
  using: "composite"
  steps:
    - name: Setup Node.js ${{ inputs.node-version }}
      uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0
      with:
        node-version: ${{ inputs.node-version }}
        cache: "npm"

    - name: Cache Turbo
      uses: ./.github/actions/cache
      with:
        path: .turbo
        key: ${{ runner.os }}-turbo-${{ github.sha }}
        restore-keys: |
          ${{ runner.os }}-turbo-

    - name: Install dependencies
      shell: bash
      run: |
        if [ -f package-lock.json ]; then
          echo "Found package-lock.json, attempting npm ci..."
          npm ci || (echo "npm ci failed, falling back to npm install..." && npm install)
        else
          echo "No package-lock.json found, running npm install..."
          npm install
        fi

    - name: Setup Playwright browsers via Turborepo
      if: ${{ inputs.playwright-setup == 'true' }}
      shell: bash
      run: npx turbo run setup:playwright

    - name: Setup Rust toolchain
      if: ${{ inputs.rust-target != '' }}
      uses: dtolnay/rust-toolchain@stable
      with:
        targets: ${{ inputs.rust-target }}

    - name: Setup Rust tools via Turborepo
      if: ${{ inputs.rust-target != '' }}
      shell: bash
      run: npx turbo run setup:rust-tools

    - name: Rust cache
      if: ${{ inputs.rust-target != '' }}
      uses: Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4 # v2.9.1
      with:
        workspaces: |
          packages/heartwood -> target
          validations/wasm-plugin/hello-world -> target
          validations/simple-wasm-plugin -> target
          templates/rust-plugin -> target
          packages/tractor -> target
```

## Conclusão

Com essas integrações, o monorepo Refarm agora possui uma estratégia de centralização de ambiente robusta e eficiente. O Turborepo atua como o orquestrador principal para a preparação de ferramentas, garantindo consistência e aproveitando o cache em todos os ambientes (desenvolvimento local, DevContainer e CI/CD). Isso resulta em tempos de setup mais rápidos, menos redundância e um ambiente de desenvolvimento mais previsível e fácil de manter.
