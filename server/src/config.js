import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env pode estar em dashboard/.env, dashboard/server/.env, na raiz do projeto ou
// no diretório de trabalho — mesma busca em cascata do dashboard comercial.
for (const candidate of [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8080),
  publicDir: process.env.PUBLIC_DIR || path.resolve(__dirname, '../public'),

  // elleven (PostgreSQL, ERP/CRM Voalle) — dsn=dbVoalle no Power BI
  elleven: {
    host: process.env.DB_ELLEVEN_HOST,
    database: process.env.DB_ELLEVEN_DATABASE,
    user: process.env.DB_ELLEVEN_USER,
    password: process.env.DB_ELLEVEN_PASSWORD,
    port: num(process.env.DB_ELLEVEN_PORT, 5432),
    max: num(process.env.DB_ELLEVEN_POOL, 5),
    statement_timeout: num(process.env.DB_ELLEVEN_TIMEOUT_MS, 60000),
    connect_timeout: num(process.env.DB_ELLEVEN_CONNECT_TIMEOUT_MS, 15000),
  },

  // DB_Massives (MariaDB) — dsn=dbMaria no Power BI
  maria: {
    host: process.env.DB_MARIA_HOST,
    database: process.env.DB_MARIA_DATABASE,
    user: process.env.DB_MARIA_USER,
    password: process.env.DB_MARIA_PASSWORD,
    port: num(process.env.DB_MARIA_PORT, 3306),
    connectionLimit: num(process.env.DB_MARIA_POOL, 5),
    timeout_ms: num(process.env.DB_MARIA_TIMEOUT_MS, 60000),
  },

  // Ponte agente -> identidade (nome livre em db_matrix/db_native não tem e-mail).
  // Achadas embutidas no Power Query original; movidas para variável de ambiente aqui.
  matrixApi: {
    url: process.env.MATRIX_API_URL,
    token: process.env.MATRIX_API_TOKEN,
  },
  nativeApi: {
    tokenUrl: process.env.NATIVE_API_TOKEN_URL,
    usersUrl: process.env.NATIVE_API_USERS_URL,
    bearer: process.env.NATIVE_API_BEARER,
    username: process.env.NATIVE_API_USERNAME,
    password: process.env.NATIVE_API_PASSWORD,
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.elleven.host) missing.push('DB_ELLEVEN_HOST');
  if (!config.elleven.database) missing.push('DB_ELLEVEN_DATABASE');
  if (!config.maria.host) missing.push('DB_MARIA_HOST');
  if (!config.maria.database) missing.push('DB_MARIA_DATABASE');
  if (missing.length) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }
}
