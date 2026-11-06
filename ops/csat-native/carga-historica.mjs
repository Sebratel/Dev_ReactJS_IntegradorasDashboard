// Carga histórica da pesquisa da URA do Native (relatório 107) em
// API_WebDeveloper.db_native_avaliations, mês a mês.
//
//   node ops/csat-native/carga-historica.mjs 2026-09-01 2026-11-06            # só conta
//   node ops/csat-native/carga-historica.mjs 2026-09-01 2026-11-06 --aplicar  # grava
//
// Monta o INSERT com o MESMO código do nó `csat_sql` do n8n (n8n-csat-sql.js), então
// rodar a carga também testa o fluxo. É idempotente: a chave única
// (origem, cod_atendimento, nom_pergunta, ramal) faz a segunda rodada só atualizar.
// Exige a migração 001 aplicada. Lê NATIVE_API_* e DB_MARIA_* do .env do dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '../..');
const require = createRequire(path.join(raiz, 'server/package.json'));
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
for (const p of [path.resolve(raiz, '../.env'), path.join(raiz, '.env')]) if (fs.existsSync(p)) dotenv.config({ path: p });

const [de, ate] = process.argv.slice(2, 4);
const aplicar = process.argv.includes('--aplicar');
if (!/^\d{4}-\d{2}-\d{2}$/.test(de || '') || !/^\d{4}-\d{2}-\d{2}$/.test(ate || '')) {
  console.error('uso: node carga-historica.mjs AAAA-MM-DD AAAA-MM-DD [--aplicar]');
  process.exit(1);
}

const codigoDoNo = fs.readFileSync(path.join(aqui, 'n8n-csat-sql.js'), 'utf8');
// eslint-disable-next-line no-new-func
const montarSql = new Function('$input', codigoDoNo);

const env = process.env;
async function token() {
  const r = await fetch(env.NATIVE_API_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.NATIVE_API_BEARER}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: env.NATIVE_API_USERNAME, password: env.NATIVE_API_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token: HTTP ${r.status}`);
  return (await r.json()).token;
}

// Mesmo filtro do fluxo: a coluna é a expressão SQL do relatório, em hora local.
const COLUNA = 'DATE_SUB(startTime, INTERVAL 3 HOUR)';
const LIMITE = 5000;
async function relatorio107(tok, inicio, fim) {
  const todas = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams();
    qs.append(COLUNA, JSON.stringify({ type: '>=', value: `'${inicio}'` }));
    qs.append(COLUNA, JSON.stringify({ type: '<=', value: `'${fim}'` }));
    qs.append('page', String(page));
    qs.append('limit', String(LIMITE));
    const r = await fetch(`https://sebratel.native-infinity.com.br/api/apiReport/107?${qs}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
    });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j.data)) throw new Error(`107: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    todas.push(...j.data);
    if (j.data.length < LIMITE) return todas;
  }
}

// Janelas de no máximo um mês, para a resposta e o INSERT não crescerem demais.
function janelas(inicio, fim) {
  const out = [];
  let d = new Date(`${inicio}T00:00:00`);
  const f = new Date(`${fim}T00:00:00`);
  const dia = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  while (d <= f) {
    const fimMes = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const corte = fimMes < f ? fimMes : f;
    out.push([`${dia(d)} 00:00:00`, `${dia(corte)} 23:59:59`]);
    d = new Date(corte.getFullYear(), corte.getMonth(), corte.getDate() + 1);
  }
  return out;
}

const conn = aplicar ? await mysql.createConnection({
  host: env.DB_MARIA_HOST, port: Number(env.DB_MARIA_PORT || 3306), user: env.DB_MARIA_USER,
  password: env.DB_MARIA_PASSWORD, database: 'API_WebDeveloper', charset: 'utf8mb4',
}) : null;

const tok = await token();
let total = 0;
for (const [inicio, fim] of janelas(de, ate)) {
  const linhas = await relatorio107(tok, inicio, fim);
  const [saida] = montarSql({ all: () => [{ json: { body: { data: linhas } } }] });
  const notas = saida?.json.notas || 0;
  total += notas;
  let gravado = '';
  if (conn && saida) {
    const [res] = await conn.query(saida.json.query);
    // affectedRows no upsert: 1 por linha nova, 2 por linha alterada, 0 por igual
    gravado = ` | affectedRows ${res.affectedRows}`;
  }
  console.log(`${inicio.slice(0, 10)} a ${fim.slice(0, 10)}: ${linhas.length} pernas, ${notas} notas${gravado}`);
}
console.log(`total: ${total} notas${aplicar ? ' gravadas' : ' (nada gravado; use --aplicar)'}`);
if (conn) await conn.end();
