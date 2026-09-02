import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        // 8080 é do dashboard comercial, que roda na mesma máquina — este projeto usa 8081
        target: process.env.API_URL || 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
});
