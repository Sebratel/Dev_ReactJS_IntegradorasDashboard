import express from 'express';
import compression from 'compression';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { assertConfig, config } from './config.js';
import { geral } from './routes/geral.js';
import { admin } from './routes/admin.js';
import { params } from './params.js';

assertConfig();

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(cors());
app.use(express.json());

// sessão, gestão de acessos, parâmetros e provedor de IA
app.use('/api', admin);
// dados do dashboard
app.use('/api/geral', geral);

// SPA (build do Vite copiado para server/public na imagem Docker)
if (fs.existsSync(config.publicDir)) {
  app.use(express.static(config.publicDir, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });
} else {
  console.warn(`[web] pasta ${config.publicDir} não encontrada — servindo apenas a API`);
}

const server = app.listen(config.port, () => {
  const p = params();
  console.log(`[web] native_matrix_dashboard em http://0.0.0.0:${config.port}`);
  console.log(`[periodo] padrão ${p.padraoDias} dias, máximo ${p.maxDias} (origem: ${p.origem})`);
  if (config.auth.habilitado) {
    console.log(`[auth] Firebase ativo — projeto ${config.auth.firebaseProjectId}, domínio @${config.auth.dominio}`);
  } else {
    // Dado de desempenho individual (produtividade, quartis) fica aberto neste
    // modo. O aviso existe para isso não passar batido em quem sobe o servidor.
    console.warn('[auth] DESLIGADA — todo mundo entra como admin. Defina FIREBASE_PROJECT_ID para ligar.');
  }
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[web] ${sig} recebido, encerrando…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
