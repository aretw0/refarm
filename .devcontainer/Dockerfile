# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# ── System dependencies ────────────────────────────────────────────────────────
# Mermaid CLI (mmdc) / headless Chromium + Playwright runtime libraries
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    locales \
    ripgrep \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libgtk-3-0 \
  && sed -i 's/^# *pt_BR.UTF-8 UTF-8/pt_BR.UTF-8 UTF-8/' /etc/locale.gen \
  && locale-gen pt_BR.UTF-8 \
  && update-locale LANG=pt_BR.UTF-8 LC_ALL=pt_BR.UTF-8 LANGUAGE=pt_BR:pt:en \
  && rm -rf /var/lib/apt/lists/*

# ── GitHub CLI ─────────────────────────────────────────────────────────────────
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# ── Rust toolchain (system-wide, accessible to vscode user) ───────────────────
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- --default-toolchain stable --profile minimal --no-modify-path -y \
  && rustup target add x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1 \
  && rustup component add rust-src

# ── wasm-tools (pre-built binary, no compilation needed) ──────────────────────
RUN tmpdir=$(mktemp -d) \
  && curl -fsSL \
      "https://github.com/bytecodealliance/wasm-tools/releases/download/v1.245.1/wasm-tools-1.245.1-x86_64-linux.tar.gz" \
     | tar -xz -C "$tmpdir" \
  && find "$tmpdir" -maxdepth 2 -name "wasm-tools" -type f -exec mv {} /usr/local/cargo/bin/ \; \
  && rm -rf "$tmpdir"

# ── cargo-component via pre-built binary (no compilation, same pattern as wasm-tools) ──
# cargo-binstall is bootstrapped, used, then removed to keep the image lean
RUN curl -L --proto '=https' --tlsv1.2 -sSf \
      "https://github.com/cargo-bins/cargo-binstall/releases/latest/download/cargo-binstall-x86_64-unknown-linux-musl.tgz" \
    | tar -xz -C /usr/local/cargo/bin \
  && cargo binstall --no-confirm --no-symlinks cargo-component@0.21.1 \
  && rm /usr/local/cargo/bin/cargo-binstall

# ── Ownership: UID 1000 = vscode (assigned by common-utils feature at runtime) ──
RUN chown -R 1000:1000 /usr/local/cargo /usr/local/rustup

# ── farm: enter as dev user from Docker Desktop root terminal ────────────────
# Usage: farm [user] [project-dir]  →  farm vscode /workspaces/refarm
# Base64-encoded to avoid heredoc quoting issues in Dockerfile RUN layers.
RUN echo IyEvYmluL2Jhc2gKVD0iJHsxOi12c2NvZGV9IjsgUD0iJHsyOi0vd29ya3NwYWNlcy9yZWZhcm19IgpJPSQobWt0ZW1wIC90bXAvZmFybS5YWFhYWFguc2gpOyBjaG1vZCA2NDQgIiRJIgpwcmludGYgJ1sgLWYgL2hvbWUvJXMvLmJhc2hyYyBdJiYuIC9ob21lLyVzLy5iYXNocmNcbmV4cG9ydCBIT01FPS9ob21lLyVzIFVTRVI9JXNcbmV4cG9ydCBOUE1fQ09ORklHX1BSRUZJWD0vaG9tZS8lcy8ubnBtLWdsb2JhbFxuZXhwb3J0IFBBVEg9L2hvbWUvJXMvLm5wbS1nbG9iYWwvYmluOi9ob21lLyVzLy5jYXJnby1sb2NhbC9iaW46L2hvbWUvJXMvLmxvY2FsL2JpbjovdXNyL2xvY2FsL2NhcmdvL2JpbjokUEFUSFxuZXhwb3J0IENBUkdPX0hPTUU9L3Vzci9sb2NhbC9jYXJnbyBSVVNUVVBfSE9NRT0vdXNyL2xvY2FsL3J1c3R1cCBDQVJHT19URVJNX0NPTE9SPWFsd2F5c1xuY2QgJXM7cm0gLWYgJXNcbicgXAogICIkVCIgIiRUIiAiJFQiICIkVCIgIiRUIiAiJFQiICIkVCIgIiRUIiAiJFAiICIkSSIgPiAiJEkiCmV4ZWMgc3UgLXMgL2Jpbi9iYXNoICIkVCIgLS0gLS1pbml0LWZpbGUgIiRJIgo= \
    | base64 -d > /usr/local/bin/farm \
  && chmod +x /usr/local/bin/farm
