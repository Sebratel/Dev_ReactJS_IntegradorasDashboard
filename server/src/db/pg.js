import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { assertReadOnly } from '../core/guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, '../sql');

// numeric/decimal -> Number (evita strings nos valores agregados)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> string YYYY-MM-DD (sem fuso, igual ao Power BI)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  host: config.elleven.host,
  database: config.elleven.database,
  user: config.elleven.user,
  password: config.elleven.password,
  port: config.elleven.port,
  max: config.elleven.max,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: config.elleven.connect_timeout,
  statement_timeout: config.elleven.statement_timeout,
  application_name: 'native-matrix-dashboard',
});

pool.on('error', (err) => {
  console.error('[pg/elleven] erro no pool:', err.message);
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
  const res = await pool.query(sql, params);
  return { rows: res.rows, ms: Date.now() - started };
}

/** Consulta parametrizada montada em código (filtros dinâmicos das telas). */
export async function query(sql, params = []) {
  assertReadOnly(sql);
  const started = Date.now();
  const res = await pool.query(sql, params);
  return { rows: res.rows, ms: Date.now() - started };
}
