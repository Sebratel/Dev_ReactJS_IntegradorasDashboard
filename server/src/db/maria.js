import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { assertReadOnly } from '../core/guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, '../sql');

export const pool = mysql.createPool({
  host: config.maria.host,
  database: config.maria.database,
  user: config.maria.user,
  password: config.maria.password,
  port: config.maria.port,
  waitForConnections: true,
  connectionLimit: config.maria.connectionLimit,
  connectTimeout: 15000,
  charset: 'utf8mb4',
  dateStrings: ['DATE', 'DATETIME'],
});

// Nem MySQL nem MariaDB têm timeout de statement no nível do pool; a variável de
// sessão certa depende do motor real por trás do host, então tentamos as duas e
// engolimos o erro da que não existir (truque emprestado do barramento de conexões
// do lakehouse_sebratel).
// O evento 'connection' entrega a conexão "crua" (estilo callback) mesmo num pool
// mysql2/promise — por isso o callback vazio em vez de .catch() numa Promise.
pool.on('connection', (conn) => {
  const ms = config.maria.timeout_ms;
  conn.query(`SET SESSION max_execution_time=${ms}`, () => {});
  conn.query(`SET SESSION max_statement_time=${ms / 1000}`, () => {});
});

const cache = new Map();
export function loadSql(name) {
  if (!cache.has(name)) {
    cache.set(name, fs.readFileSync(path.join(SQL_DIR, `${name}.sql`), 'utf8'));
  }
  return cache.get(name);
}

export async function queryFile(name, params = []) {
  const sql = loadSql(name);
  assertReadOnly(sql);
  const started = Date.now();
  const [rows] = await pool.query(sql, params);
  return { rows, ms: Date.now() - started };
}

/**
 * Consulta parametrizada montada em código (os filtros das telas são dinâmicos:
 * a quantidade de valores marcados muda a cada clique). Os valores vão sempre por
 * placeholder `?`, nunca interpolados na string.
 */
export async function query(sql, params = []) {
  assertReadOnly(sql);
  const started = Date.now();
  const [rows] = await pool.query(sql, params);
  return { rows, ms: Date.now() - started };
}
