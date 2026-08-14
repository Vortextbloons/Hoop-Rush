import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
                                                    
    host: true,
    port: 5173,
    strictPort: true,
                                                                                  
    allowedHosts: true,
    fs: {
      allow: ['../..'],
    },
                                                                                 
    hmr: {
      clientPort: 5173,
    },
  },
});
