import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(webRoot, 'build');

// Engine modules that reach the Wasm/simulation kernels. Vite 8's Rolldown
// client build ignores manualChunks because SvelteKit sets codeSplitting, so
// this list splits the server chunks and the client group below names the
// possession byte literal explicitly.
const ENGINE_SIM_MODULES = [
  'packages/engine/src/index.ts',
  'packages/engine/src/sim/possession-wasm.ts',
  'packages/engine/src/sim/wasm/',
  'packages/engine/src/sim/wasm-runtime.ts',
  'packages/engine/src/sim/game.ts',
  'packages/engine/src/sim/tape.ts',
  'packages/engine/src/sim/wasm-game.ts',
  'packages/engine/src/modes/full-court/game.ts',
  'packages/engine/src/modes/havoc/core/battle-wasm.ts',
  'packages/engine/src/modes/havoc/core/battle-game.ts',
  'packages/engine/src/modes/cap-rush/league-simulation.ts',
];

function isEngineSimModule(id: string): boolean {
  const normalized = id.replaceAll('\\', '/');
  return ENGINE_SIM_MODULES.some((modulePath) => normalized.includes(modulePath));
}

// Vite 8/Rolldown ignores manualChunks once SvelteKit sets codeSplitting for
// the client build, so name the possession byte literal through that hook.
// The literal has no dependencies, so naming it cannot pull helpers in.
function engineWasmChunkPlugin(): Plugin {
  return {
    name: 'hoop-rush-engine-wasm-chunk',
    apply: 'build',
    config(config) {
      const output = config.environments?.client?.build?.rolldownOptions?.output;
      if (output === undefined || Array.isArray(output)) return;
      const existing = output.codeSplitting;
      if (existing === undefined || typeof existing === 'boolean') return;
      return {
        environments: {
          client: {
            build: {
              rolldownOptions: {
                output: {
                  codeSplitting: {
                    groups: [
                      ...(existing.groups ?? []),
                      {
                        name: 'hoop-engine-sim',
                        test: 'sim/wasm/possession-wasm.gen.ts',
                        priority: 20,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      };
    },
  };
}

function devProbeStubPlugin(): Plugin {
  const stubs: Record<string, string> = {
    '/global/health': '{"ok":true}',
    '/json/version': '{"Browser":"","Protocol-Version":"1.3"}',
  };

  return {
    name: 'hoop-rush-dev-probe-stub',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const body = path ? stubs[path] : undefined;
        if (!body) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    devProbeStubPlugin(),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ fallback: 'index.html', precompress: true }),
      paths: {
        base: process.argv.includes('dev')
          ? ''
          : ((process.env.BASE_PATH ?? '') as '' | `/${string}`),
      },
    }),
    engineWasmChunkPlugin(),
    tailwindcss(),
  ],
  optimizeDeps: {
    include: ['bits-ui', '@supabase/supabase-js', 'dexie'],
    exclude: ['@hoop-rush/engine', '@hoop-rush/data-contracts', '@hoop-rush/persistence'],
  },
  environments: {
    ssr: {
      optimizeDeps: {
        include: ['@lucide/svelte'],
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase';
          if (id.includes('node_modules/bits-ui')) return 'vendor-bits-ui';
          if (id.includes('node_modules/dexie')) return 'vendor-dexie';
          if (id.includes('node_modules/@lucide/')) return 'vendor-lucide';
          if (id.includes('packages/data-contracts') || id.includes('@hoop-rush/data-contracts'))
            return 'hoop-data-contracts';
          if (id.includes('packages/engine') || id.includes('@hoop-rush/engine'))
            return isEngineSimModule(id) ? 'hoop-engine-sim' : 'hoop-engine-core';
          if (id.includes('packages/persistence') || id.includes('@hoop-rush/persistence'))
            return 'hoop-persistence';
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,

    allowedHosts: true,
    watch: {
      ignored: [buildDir, `${buildDir}/**`],
    },
    fs: {
      allow: ['../..'],
    },

    hmr: {
      clientPort: 5173,
    },
  },
});
