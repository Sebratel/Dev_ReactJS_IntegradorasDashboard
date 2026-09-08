# Imagem única: o Express serve a API e também o bundle do Vite (server/public).
# Não há nginx aqui de propósito — quem serve o front é o mesmo processo que
# responde /api, então não existe CORS nem proxy para configurar no deploy.

# ---------- 1) build do front (Vite/React) ----------
FROM node:20-alpine AS web
WORKDIR /app/web

# As VITE_* entram no BUNDLE em tempo de build — não são lidas em runtime.
# Trocar qualquer uma delas exige RECONSTRUIR a imagem; reiniciar o container
# não muda nada. Elas não são segredo (vão no JavaScript do cliente por
# design), mas restrinja a chave no Google Cloud a Identity Toolkit e Token
# Service.
#
# Por que ARG e não .env: o `vite.config.js` aponta `envDir: '../../'` para
# achar o .env que mora fora do repositório, na máquina do desenvolvedor. Esse
# caminho não existe dentro da imagem, e o Vite ignoraria as variáveis EM
# SILÊNCIO — o build sairia sem login e sem erro nenhum para explicar. O
# `loadEnv` do Vite dá prioridade ao que já está no process.env, então passar
# por ARG->ENV funciona independente do envDir.
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_APP_ID=""
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 2) dependências do servidor ----------
FROM node:20-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 3) imagem final ----------
FROM node:20-alpine

# TZ importa para o dado, não para o log: as bases guardam hora LOCAL, e os
# limites de data das consultas são montados a partir da hora do processo.
# Rodar em UTC desloca a janela de todas as telas em 3 horas.
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PORT=8091

RUN apk add --no-cache tzdata wget && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/src ./src
COPY --from=web /app/web/dist ./public

# Estado de runtime: papéis e permissões por tela (access.json), o recorte de
# datas (params.json), o provedor de IA (ia.json) e a chave que cifra a chave
# de API (.secret). Tudo mora ao lado do ACCESS_PATH. Precisa de volume: sem
# ele a configuração morre a cada recriação do container, e a chave de IA
# gravada fica ilegível junto com o .secret que a protegia.
RUN mkdir -p /app/data && chown -R app:app /app/data
ENV ACCESS_PATH=/app/data/access.json \
    PARAMS_PATH=/app/data/params.json

USER app
EXPOSE 8091

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/geral/health" > /dev/null || exit 1

CMD ["node", "src/index.js"]
