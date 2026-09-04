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
        if (!body) { next(); return; }
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
    // Pre-bundle workspace packages so dev does not serve raw @fs .ts (breaks HMR on paths with spaces).
    include: [
      '@hoop-rush/engine',
      '@hoop-rush/data-contracts',
      '@hoop-rush/persistence',
      'bits-ui',
      '@supabase/supabase-js',
      'dexie',
    ],
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
