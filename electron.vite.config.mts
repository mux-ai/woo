import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const contentSecurityPolicy = {
  name: 'woo-content-security-policy',
  transformIndexHtml(html: string, context: { server?: unknown }) {
    const connectSource = context.server
      ? "'self' http://localhost:* ws://localhost:*"
      : "'none'"
    return html.replace('__WOO_CONNECT_SRC__', connectSource)
  }
}

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // node-pty: native module — cannot be bundled, loaded from
        // node_modules. @openai/codex-sdk must NOT be externalized: it is
        // pure ESM (no require entry) and the CJS main bundle would crash
        // at launch with ERR_PACKAGE_PATH_NOT_EXPORTED — bundle it instead.
        external: ['node-pty'],
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'codex-secret-hook': resolve(import.meta.dirname, 'src/main/codexSecretHook.ts')
        },
        onwarn(warning, warn) {
          const source = `${warning.id ?? ''} ${warning.message}`
          const knownUpstreamUnusedImport =
            warning.code === 'UNUSED_EXTERNAL_IMPORT' &&
            (source.includes('@anthropic-ai/claude-agent-sdk') || source.includes('chokidar'))
          if (!knownUpstreamUnusedImport) warn(warning)
        }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/renderer/index.html')
      }
    },
    plugins: [contentSecurityPolicy, react()]
  }
})
