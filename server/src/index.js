import express from 'express';
import compression from 'compression';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { assertConfig, config } from './config.js';
import { geral } from './routes/geral.js';

assertConfig();

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(cors());
app.use(express.json());

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
  console.log(`[web] native_matrix_dashboard em http://0.0.0.0:${config.port}`);
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
