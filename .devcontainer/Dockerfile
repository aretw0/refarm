FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# System dependencies required by Mermaid CLI (mmdc) and headless Chromium
# so `npm run diagrams:fix` works out-of-the-box in fresh containers.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
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
  && rm -rf /var/lib/apt/lists/*
