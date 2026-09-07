import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /**
   * O `.env` do projeto mora em `native_matrix_Dashboard/.env`, um nível ACIMA do
   * repositório — de propósito, para o arquivo com as senhas dos bancos não
   * entrar no versionamento. O Vite, por padrão, só procura `.env` na pasta do
   * front, então sem isto as variáveis `VITE_FIREBASE_*` seriam simplesmente
   * ignoradas: o build sairia sem login e sem erro nenhum para explicar.
   */
  envDir: '../../',
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
