import { config } from '../config.js';

const TTL_MS = 30 * 60 * 1000;
let cache = null;
let cachedAt = 0;

/**
 * Ponte agente -> identidade do MatrixGO (`db_matrix.atendente` é texto livre, sem
 * e-mail). Espelha a paginação feita no Power Query original: GET .../agentes?page=N
 * até `result` vir vazio ou `total` ser atingido.
 */
export async function agentesMatrix() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;

  const linhas = [];
  let page = 1;
  for (;;) {
    const url = new URL(config.matrixApi.url);
    url.searchParams.set('page', String(page));
    const resp = await fetch(url, { headers: { Authorization: config.matrixApi.token } });
    if (!resp.ok) break;
    const data = await resp.json();
    const result = data.result || [];
    if (!result.length) break;
    linhas.push(...result);
    if (linhas.length >= (data.total || 0)) break;
    page += 1;
  }

  const porAgente = new Map();
  for (const linha of linhas) {
    if (!porAgente.has(linha.agente)) porAgente.set(linha.agente, linha);
  }
  cache = [...porAgente.values()];
  cachedAt = Date.now();
  return cache;
}
