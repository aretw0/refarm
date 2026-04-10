import { fileURLToPath, URL } from 'node:url';
import { createLogger, defineConfig } from 'vite';
import { withWasmBrowserConfig } from '@refarm.dev/vtconfig';

const shouldSuppressNodeExternalizedWarning =
  process.env.VITE_SUPPRESS_NODE_EXTERNALIZED_WARNING === '1';

const logger = createLogger();
const defaultWarn = logger.warn;

logger.warn = (msg, options) => {
  if (
    shouldSuppressNodeExternalizedWarning &&
    msg.includes('has been externalized for browser compatibility') &&
    msg.includes('node:fs/promises')
  ) {
    return;
  }
  defaultWarn(msg, options);
};

export default withWasmBrowserConfig(
  defineConfig({
    customLogger: logger,
    resolve: {
      alias: {
        // DX guard: if a Node-only branch is accidentally executed in browser,
        // this shim fails fast with an explicit message instead of obscure errors.
        'node:fs/promises': fileURLToPath(
          new URL('./src/shims/fs-promises-browser.ts', import.meta.url),
        ),
      },
    },
    server: {
      port: 5173,
      open: true,
    },
    build: {
      target: 'esnext',
    },
  }),
);
