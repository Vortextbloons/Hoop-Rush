import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
    // Listen on LAN/Tailscale as well as localhost.
    host: true,
    port: 5173,
    strictPort: true,
    // Tailscale hostnames and other non-local hosts (IPs are allowed by default).
    allowedHosts: true,
    fs: {
      allow: ['../..'],
    },
    // Keep HMR websocket on the same port the page loaded from (Tailscale-safe).
    hmr: {
      clientPort: 5173,
    },
  },
});
