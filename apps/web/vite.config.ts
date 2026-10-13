import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(webRoot, 'build');

/** Stub CDP/health probes that hit the dev server when --host exposes port 5173. */
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
  plugins: [devProbeStubPlugin(), sveltekit(), tailwindcss()],
  optimizeDeps: {
    include: ['bits-ui', '@supabase/supabase-js', 'dexie'],
    exclude: ['@hoop-rush/engine', '@hoop-rush/data-contracts', '@hoop-rush/persistence'],
  },
  environments: {
    // SSR dep optimization has dependency discovery disabled, so a barrel package
    // like @lucide/svelte must be listed explicitly or every icon module (~2000)
    // is resolved and transformed on the first SSR request.
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
          // Keep workspace packages in package-owned chunks. Rollup's default
          // splitting previously scattered data-contracts modules into the
          // engine chunk, creating a circular chunk dependency. Any module
          // top-level read of an imported constant (e.g. `X.length`) then
          // crashed with `Cannot read properties of undefined` depending on
          // chunk evaluation order. Package-owned chunks keep the chunk graph
          // acyclic (engine -> data-contracts) so evaluation order is safe.
          if (id.includes('packages/data-contracts') || id.includes('@hoop-rush/data-contracts'))
            return 'hoop-data-contracts';
          if (id.includes('packages/engine') || id.includes('@hoop-rush/engine'))
            return 'hoop-engine';
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
