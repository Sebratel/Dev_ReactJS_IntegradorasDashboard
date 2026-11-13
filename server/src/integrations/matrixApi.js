import { config } from '../config.js';

const TTL_MS = 30 * 60 * 1000;
let cache = null;
let cachedAt = 0;

/**
 * Ponte agente -> identidade do MatrixGO (`db_matrix.atendente` é texto livre, sem
 * e-mail). Espelha a paginação feita no Power Query original: GET .../agentes?page=N
 * até `result` vir vazio ou `total` ser atingido.
 *
 * Falha no meio da paginação (D-13): a origem parava em silêncio e a lista ficava
 * parcial, com agentes sumindo das telas sem aviso. Aqui o erro vai para o log e a
 * lista incompleta NÃO entra no cache: se há uma lista completa anterior, ela
 * continua valendo; se não há, a parcial é usada só nesta chamada, e a próxima
 * tenta de novo.
 */
export async function agentesMatrix() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;

  const linhas = [];
  let page = 1;
  let falha = null;
  for (;;) {
    const url = new URL(config.matrixApi.url);
    url.searchParams.set('page', String(page));
    let data;
    try {
      const resp = await fetch(url, { headers: { Authorization: config.matrixApi.token } });
      if (!resp.ok) { falha = `HTTP ${resp.status} na página ${page}`; break; }
      data = await resp.json();
    } catch (err) {
      falha = `${err.message} na página ${page}`;
      break;
    }
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
  const lista = [...porAgente.values()];

  if (falha) {
    console.error(`[matrixApi] lista de agentes incompleta (${lista.length} lidos): ${falha}`
      + (cache ? ' — mantida a lista anterior' : ' — usada só nesta consulta, sem cache'));
    if (cache) return cache;
    // marca para o mapa de agentes também não guardar esta lista (model/agentes.js)
    Object.defineProperty(lista, 'parcial', { value: true });
    return lista;
  }

  cache = lista;
  cachedAt = Date.now();
  return cache;
}
