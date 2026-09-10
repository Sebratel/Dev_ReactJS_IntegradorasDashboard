import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * Onde mora o `.env` — procurado, não fixado.
 *
 * O Vite aceita UM caminho em `envDir`. Se ele aponta para o lugar errado, as
 * `VITE_*` são ignoradas EM SILÊNCIO: o build sai sem login, sem erro nenhum
 * para explicar. Aconteceu — o arquivo já morou na pasta do projeto (um nível
 * acima do repositório) e depois foi movido para a raiz do repositório, o que
 * deixou o caminho fixo apontando para o vazio.
 *
 * Procurar nos dois lugares resolve as duas épocas, e sobreviver a mover o
 * arquivo de novo é justamente o ponto.
 */
const envDir = [
  path.resolve(aqui, '..'), // dashboard/ — raiz do repositório, onde está hoje
  path.resolve(aqui, '../..'), // native_matrix_Dashboard/ — onde já esteve
].find((d) => fs.existsSync(path.join(d, '.env'))) ?? path.resolve(aqui, '..');

export default defineConfig({
  plugins: [react()],
  // Sem isto o Vite só procuraria `.env` dentro de `web/`. Ver o comentário do
  // `envDir` no topo: o caminho é procurado porque já quebrou uma vez.
  envDir,
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
